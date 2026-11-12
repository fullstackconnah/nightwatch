using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Text.Json;
using NightwatchDesk.Core;

namespace NightwatchDesk.App;

/// <summary>Where the desk keeps things. desk.json is read only; state.json is the window's own memory.</summary>
internal static class DeskFiles
{
    public static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "NightwatchDesk");
    public static readonly string Config = Path.Combine(Dir, "desk.json");
    public static readonly string State = Path.Combine(Dir, "state.json");
}

internal sealed record WinState(double Left, double Top, string Anchor, bool AlwaysOnTop, Box? WorkArea, bool CameraCollapsed = false)
{
    static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    public static WinState? Load(string path)
    {
        try { return File.Exists(path) ? JsonSerializer.Deserialize<WinState>(File.ReadAllText(path), Json) : null; }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException) { return null; }
    }

    public void Save(string path)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(this, Json));
            File.Move(tmp, path, overwrite: true); // atomic: a crash mid-write never leaves a half file
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { } // the position is a nicety; never crash on it
    }
}

/// <summary>The only network code: one GET. The exception text is dropped on purpose (N20: nothing near the token is ever surfaced).</summary>
internal static class Poller
{
    public const long MaxGlanceBytes = 256 * 1024;

    /// <summary>The glance is buffered, so the cap makes an oversize body throw (mapped to Failed). The camera reads headers-first and streams under its own cap.</summary>
    public static HttpClient NewClient(HttpMessageHandler? handler = null) =>
        new(handler ?? new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(10), MaxResponseContentBufferSize = MaxGlanceBytes };

    public static async Task<Outcome> FetchAsync(HttpClient http, ConfigResult.Ok cfg)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, cfg.BaseUrl + "/api/desk/glance");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", cfg.Token);
            using var resp = await http.SendAsync(req).ConfigureAwait(false);
            var body = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
            return Poll.Map((int)resp.StatusCode, body);
        }
        catch (Exception)
        {
            return new Outcome.Failed();
        }
    }

    /// <summary>The public doorbell read (no token is sent). Null on any failure, so a bad poll is silent.</summary>
    public static async Task<DoorSnapshot?> FetchDoorAsync(HttpClient http, string baseUrl)
    {
        try
        {
            using var resp = await http.GetAsync(baseUrl + "/kiosk/api/doorbell").ConfigureAwait(false);
            if ((int)resp.StatusCode != 200) return null;
            return DoorParser.Parse(await resp.Content.ReadAsStringAsync().ConfigureAwait(false));
        }
        catch (Exception)
        {
            return null;
        }
    }
}

/// <summary>"Start with Windows" is a .lnk in the Startup folder: no admin, no registry.</summary>
internal static class Autostart
{
    static string Lnk => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Nightwatch Desk.lnk");
    public static bool Enabled => File.Exists(Lnk);

    public static void Set(bool on)
    {
        if (!on) { if (File.Exists(Lnk)) File.Delete(Lnk); return; }
        var exe = Environment.ProcessPath;
        if (exe is null || Type.GetTypeFromProgID("WScript.Shell") is not { } t) return;
        dynamic shell = Activator.CreateInstance(t)!;
        try
        {
            dynamic link = shell.CreateShortcut(Lnk);
            link.TargetPath = exe;
            link.WorkingDirectory = Path.GetDirectoryName(exe);
            link.Save();
        }
        finally { Marshal.ReleaseComObject(shell); }
    }
}

internal static class Native
{
    public const int GwlExStyle = -20, WsExToolWindow = 0x80;
    public const uint SwpNoSize = 1, SwpNoMove = 2, SwpNoActivate = 0x10;
    public static readonly IntPtr HwndBottom = new(1);

    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLong(IntPtr h, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern IntPtr SetWindowLong(IntPtr h, int index, IntPtr value);
    [DllImport("kernel32.dll")] public static extern bool AttachConsole(int pid);
}
