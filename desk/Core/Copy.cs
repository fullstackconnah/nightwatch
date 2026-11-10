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
}
