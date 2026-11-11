using System.Globalization;

namespace NightwatchDesk.Core;

/// <summary>The desk's own words for each state (the server's glance carries the rest). Strings match SHAPE.md.</summary>
public static class Copy
{
    public const int TooltipMax = 63; // NotifyIcon.Text takes 127 (probed in App.Tests, OPEN-1); 63 kept: one glanceable line
    public const int ToastTitleMax = 63;
    public const int ToastTextMax = 255;

    /// <summary>The config folder with U+2060 between every character, so a line breaks before the path, never inside it.</summary>
    public static readonly string ConfigDirText = string.Join("\u2060", @"%APPDATA%\NightwatchDesk".ToCharArray());

    public static string Clock(DateTimeOffset t, TimeZoneInfo tz) =>
        TimeZoneInfo.ConvertTime(t, tz).ToString("HH:mm", CultureInfo.InvariantCulture);

    public static string AsOf(DateTimeOffset t, TimeZoneInfo tz) => $"as of {Clock(t, tz)}";

    public static string ProbeLine(Probes p, DateTimeOffset checkedAt, TimeZoneInfo tz) =>
        $"{p.Answered} of {p.Total} checks answered at {Clock(checkedAt, tz)}";

    public static string Head(View v) => v switch
    {
        View.Live l => l.Glance.Answer,
        View.Stale s => s.Glance?.Answer ?? "Checking the box…",
        View.Offline => "Can't get an answer from the box right now",
        View.FirstLaunch => "Checking the box…",
        View.Config c => c.Kind switch
        {
            ConfigResult.Unreadable => "desk.json can't be read",
            ConfigResult.TokenMissing => "Desk token missing",
            ConfigResult.BadAddress => "nightwatch address isn't valid",
            _ => "Desk isn't set up yet",
        },
        View.WrongToken => "nightwatch refused the desk token",
        View.DeskOff => "Desk access is off on nightwatch",
        View.ServerTooNew => "Nightwatch Desk needs an update",
        _ => "",
    };

    public static string? Note(View v) => v switch
    {
        View.Config c => c.Kind switch
        {
            ConfigResult.Unreadable u => $"It isn't valid JSON (line {u.Line}). Fix it, then choose Refresh.",
            ConfigResult.TokenMissing => "Set \"token\" in desk.json to the desk token from nightwatch's config. Then choose Refresh.",
            ConfigResult.BadAddress => "Set \"baseUrl\" in desk.json to a full address, like http://homelab.local:3005. Then choose Refresh.",
            _ => @"Run desk\install.ps1, or create desk.json in " + ConfigDirText + " with baseUrl and token. Then choose Refresh.",
        },
        View.WrongToken => "The token in desk.json doesn't match the server's. Replace it, then choose Refresh.",
        View.DeskOff => "Set system.deskToken on the server: 32 or more characters, different from the MCP token.",
        View.ServerTooNew s => $"The server sends format v{s.V}. Pull origin/main and re-run the desk install.",
        _ => null,
    };

    public static string? Footer(View v, TimeZoneInfo tz) => v switch
    {
        View.Live l => ProbeLine(l.Glance.Probes, l.Glance.CheckedAt, tz),
        View.FirstLaunch => "Asking nightwatch…",
        View.Stale s => NoAnswer(s.LastSuccess, tz),
        View.Offline o => NoAnswer(o.LastSuccess, tz),
        View.WrongToken w => $"Refused at {Clock(w.At, tz)}",
        View.DeskOff d => $"Refused at {Clock(d.At, tz)}",
        _ => null,
    };

    static string NoAnswer(DateTimeOffset? since, TimeZoneInfo tz) =>
        since is { } t ? $"No answer since {Clock(t, tz)}" : "No answer yet";

    public static string Tooltip(View v, TimeZoneInfo tz) =>
        Trim(v is View.Stale { LastSuccess: { } t } ? $"{Head(v)} ({AsOf(t, tz)})" : Head(v), TooltipMax);

    /// <summary>Cuts to at most <paramref name="max"/> UTF-16 units, ending in "…", without splitting a surrogate pair.</summary>
    public static string Trim(string s, int max)
    {
        if (s.Length <= max) return s;
        var cut = max - 1;
        if (cut > 0 && char.IsHighSurrogate(s[cut - 1])) cut--;
        return s[..cut] + "…";
    }

    // --- Camera and weather (SHAPE 2 and 4). Strings are exact; none has an apostrophe or quote. ---
    public const string CameraTitle = "Front door";
    public const string CameraLoading = "Waking the camera…";
    public const string CameraNoPicture = "No picture";
    public const string CameraFolded = "Hidden to fit the screen";
    public const string CameraFrameTip = "Open the kiosk to watch live";
    public const string CameraHeaderName = "Front door camera";
    public const string NullFigure = "—";

    /// <summary>HH:mm:ss, 24 hour, invariant. The caller passes local time.</summary>
    public static string AgeClock(DateTime t) => t.ToString("HH:mm:ss", CultureInfo.InvariantCulture);

    public static string FrameAge(DateTime t) => $"as of {AgeClock(t)}";

    public static string CameraLastFrame(DateTime? t) => t is { } x ? $"Last frame at {AgeClock(x)}" : "No frame from the camera yet";

    public static string CameraHeaderTip(bool collapsed, bool folded) =>
        folded ? "There is no room for the picture on this screen right now. It comes back when there is." : collapsed ? "Show the camera" : "Hide the camera";

    public static string CameraFrameName(FrameState s, DateTime? t) => s switch
    {
        FrameState.Loading => "Front door camera, waking. Opens the kiosk.",
        FrameState.NoPicture => "Front door camera, no picture. Opens the kiosk.",
        _ => t is { } x ? $"Front door camera, {FrameAge(x)}. Opens the kiosk." : "Front door camera, waking. Opens the kiosk.",
    };

    // The kiosk rounds with JS Math.round (half up); C# default is banker rounding, which differs at .5.
    static int Round(double x) => (int)Math.Floor(x + 0.5);
    static string Deg(double? x) => x is { } v ? $"{Round(v).ToString(CultureInfo.InvariantCulture)}°" : NullFigure;

    public static string WeatherTemp(WeatherNow w) => Deg(w.TempC);

    public static string WeatherLabel(WeatherNow w) => w.Label ?? "";

    public static string WeatherLine2(WeatherNow w) => string.Join(" · ", Clauses(
        w.FeelsC is { } f ? $"feels {Deg(f)}" : null,
        w.HighC is { } h ? $"H {Deg(h)}" : null,
        w.LowC is { } l ? $"L {Deg(l)}" : null,
        w.RainPct is { } r ? $"{Round(r).ToString(CultureInfo.InvariantCulture)}% rain" : null));

    /// <summary>"{label}, {t}, feels like {f}. High {h}, low {l}, {r}% chance of rain." with null clauses dropped.</summary>
    public static string WeatherTooltip(WeatherNow w)
    {
        var now = string.Join(", ", Clauses(string.IsNullOrEmpty(w.Label) ? null : w.Label, w.TempC is { } t ? Deg(t) : null, w.FeelsC is { } f ? $"feels like {Deg(f)}" : null));
        var day = string.Join(", ", Clauses(w.HighC is { } h ? $"High {Deg(h)}" : null, w.LowC is { } l ? $"low {Deg(l)}" : null,
            w.RainPct is { } r ? $"{Round(r).ToString(CultureInfo.InvariantCulture)}% chance of rain" : null));
        return string.Join(" ", new[] { now, day }.Where(s => s.Length > 0).Select(s => s + "."));
    }

    static IEnumerable<string> Clauses(params string?[] parts) => parts.Where(p => p is not null)!;

    /// <summary>The lucide icon name for a glance weather icon key; an unknown or missing key is a cloud (as weather.ts does).</summary>
    public static string GlyphKey(string? icon) => icon switch
    {
        "clear" => "sun",
        "partly-cloudy" => "cloud-sun",
        "fog" => "cloud-fog",
        "drizzle" => "cloud-drizzle",
        "rain" => "cloud-rain",
        "snow" => "cloud-snow",
        "showers" => "cloud-rain-wind",
        "thunderstorm" => "cloud-lightning",
        _ => "cloud",
    };
}
