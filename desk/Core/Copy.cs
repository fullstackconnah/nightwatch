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

    /// <summary>The door toast: one title, the text by trigger kind (an unknown kind reads as movement), a click to the kiosk door view.</summary>
    public static Toast DoorToast(string? kind, string baseUrl) => new("Front door", kind switch
    {
        "ding" => "Someone rang the doorbell.",
        "person" => "Someone is at the front door.",
        _ => "Movement at the front door.",
    }, new Click.OpenUrl(baseUrl + "/kiosk?door=1"));
    public const string CameraHeaderName = "Front door camera";
    public const string NullFigure = "—";

    /// <summary>HH:mm:ss, 24 hour, invariant. The caller passes local time.</summary>
    public static string AgeClock(DateTime t) => t.ToString("HH:mm:ss", CultureInfo.InvariantCulture);

    public static string FrameAge(DateTime t) => $"as of {AgeClock(t)}";

    public static string CameraLastFrame(DateTime? t) => t is { } x ? $"Last frame at {AgeClock(x)}" : "No frame from the camera yet";

    // Watch live: the second header button. The automation name is fixed; the toggle state says on or off.
    public const string CameraWatchLive = "Watch live";
    public const string CameraLiveOn = "Live";
    public const string CameraLiveName = "Watch the front door live";
    public const string CameraLiveFrameTip = "Open the kiosk for the full stream";
    public static string CameraLiveTip(bool on) => on ? "Stop the live view" : "Watch the front door, updated every second";

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

    /// <summary>"24°", or the null figure.</summary>
    public static string Degrees(double? x) => Deg(x);

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

    // --- TODAY (slice 2): date and clock are invariant, in the widget zone; no culture-dependent format. ---
    public const string SectionFolded = "Hidden to fit the screen. Close another section to make room.";

    /// <summary>"THU 1 JAN".</summary>
    public static string TodayDate(DateTimeOffset t, TimeZoneInfo tz) =>
        TimeZoneInfo.ConvertTime(t, tz).ToString("ddd d MMM", CultureInfo.InvariantCulture).ToUpperInvariant();

    /// <summary>The header's automation name, "Today, Thursday 1 January, 14:05".</summary>
    public static string TodayName(DateTimeOffset t, TimeZoneInfo tz) =>
        $"Today, {TimeZoneInfo.ConvertTime(t, tz).ToString("dddd d MMMM", CultureInfo.InvariantCulture)}, {Clock(t, tz)}";

    public static string TodayHeaderTip(bool closed, bool folded) => folded ? SectionFolded : closed ? "Show the weather" : "Hide the weather";

    /// <summary>A forecast day is already a local calendar date (yyyy-MM-dd): no zone conversion. Null when it does not parse.</summary>
    public static DateOnly? ForecastDate(string? day) =>
        DateOnly.TryParseExact(day, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    /// <summary>"FRI", or null when the day does not parse.</summary>
    public static string? ForecastDayName(string? day) => ForecastDate(day)?.ToString("ddd", CultureInfo.InvariantCulture).ToUpperInvariant();

    /// <summary>"Friday: high 24°, low 15°, rain 60%" with null clauses dropped; null when the day does not parse.</summary>
    public static string? ForecastTooltip(ForecastDay d) =>
        ForecastDate(d.Day) is not { } date ? null
        : date.ToString("dddd", CultureInfo.InvariantCulture) + (Clauses(d.HighC is { } h ? $"high {Deg(h)}" : null, d.LowC is { } l ? $"low {Deg(l)}" : null,
            d.RainPct is { } r ? $"rain {Round(r).ToString(CultureInfo.InvariantCulture)}%" : null).ToArray() is { Length: > 0 } c ? ": " + string.Join(", ", c) : "");

    static IEnumerable<string> Clauses(params string?[] parts) => parts.Where(p => p is not null)!;

    // --- MEDIA (slice 3): invariant culture, no apostrophes. ---
    public const string MediaTitle = "Media";

    public static string MediaHeaderTip(bool closed, bool folded) => folded ? SectionFolded : closed ? "Show media" : "Hide media";

    /// <summary>"Playing · 2 downloading", "Paused", "2 downloading", or "" when there is neither.</summary>
    public static string MediaMeta(NowPlaying? np, int count) => string.Join(" · ", Clauses(
        NowPlaying.Usable(np) is { } u ? (u.State == "paused" ? "Paused" : "Playing") : null,
        count > 0 ? $"{count.ToString(CultureInfo.InvariantCulture)} downloading" : null));

    /// <summary>"Series · App" with missing clauses dropped; paused prefixes "Paused · "; with neither it reads Playing or Paused.</summary>
    public static string NowPlayingLine2(NowPlaying np)
    {
        var paused = np.State == "paused";
        var line = string.Join(" · ", Clauses(paused ? "Paused" : null, Blank(np.Subtitle), Blank(np.AppName)));
        return line.Length > 0 ? line : "Playing";
    }

    static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;

    public static string NowPlayingTip(NowPlaying np) => $"{np.Title}\n{NowPlayingLine2(np)}";

    static bool Stalled(DownloadItem d) => d.SpeedBps is not { } s || !double.IsFinite(s) || s <= 0;

    // Floor, not round, so 100% only when done; the epsilon keeps 0.29 (28.999999999999996) at 29.
    static int Percent(DownloadItem d) => d.Progress is { } p && double.IsFinite(p) ? (int)Math.Floor(Math.Min(1, Math.Max(0, p)) * 100 + 1e-9) : 0;

    static string Rate(double bps)
    {
        if (bps < 1000) return $"{Round(bps).ToString(CultureInfo.InvariantCulture)} B/s";
        var kb = Round(bps / 1000);
        return kb < 1000 ? $"{kb.ToString(CultureInfo.InvariantCulture)} KB/s" : $"{(bps / 1e6).ToString("0.0", CultureInfo.InvariantCulture)} MB/s";
    }

    /// <summary>"43% · 2.1 MB/s"; no or zero speed reads "43% · stalled".</summary>
    public static string DownloadRight(DownloadItem d) => $"{Percent(d).ToString(CultureInfo.InvariantCulture)}% · {(Stalled(d) ? "stalled" : Rate(d.SpeedBps!.Value))}";

    /// <summary>"Name, 43%, about 12 min left"; no estimate drops the clause, no speed says stalled.</summary>
    public static string DownloadTip(DownloadItem d)
    {
        string? tail = Stalled(d) ? "stalled" : d.EtaS is { } s && double.IsFinite(s) && s > 0
            ? s < 60 ? "less than a minute left" : s < 3600 ? $"about {Math.Ceiling(s / 60).ToString(CultureInfo.InvariantCulture)} min left" : $"about {Round(s / 3600).ToString(CultureInfo.InvariantCulture)} h left"
            : null;
        return string.Join(", ", Clauses(d.Name, $"{Percent(d).ToString(CultureInfo.InvariantCulture)}%", tail));
    }

    // --- HOME (slice 4): invariant culture, no apostrophes. ---
    public const string HomeTitle = "Home";
    public const string LightsCaption = "LIGHTS";
    public const string ClimateCaption = "CLIMATE";
    public const string ContainersCaption = "CONTAINERS";

    /// <summary>"Lights: 3 of 12 on", the line's tooltip and automation name.</summary>
    public static string LightsTip(HomeLights l) => $"Lights: {LightsValue(l)}";

    public static string HomeHeaderTip(bool closed, bool folded) => folded ? SectionFolded : closed ? "Show home" : "Hide home";

    /// <summary>"21.5°" or "22°": half up to a tenth, a trailing .0 dropped, never "-0°". Null or not finite is the null figure.</summary>
    public static string ClimateDeg(double? x)
    {
        if (x is not { } v || !double.IsFinite(v)) return NullFigure;
        var r = Math.Floor(v * 10 + 0.5) / 10;
        return (r == 0 ? 0 : r).ToString("0.#", CultureInfo.InvariantCulture) + "°";
    }

    static string Int(int n) => n.ToString(CultureInfo.InvariantCulture);

    /// <summary>"3 of 12 on", or "All off" when none is.</summary>
    public static string LightsValue(HomeLights l) => l.LightsOn == 0 ? "All off" : $"{Int(l.LightsOn)} of {Int(l.LightsTotal)} on";

    /// <summary>"21.5° → 22°"; mode off "21.5° · off"; no target "21.5°"; no current reading the null figure.</summary>
    public static string ClimateValue(HomeClimate c) =>
        c.CurrentC is null ? NullFigure
        : c.Mode == "off" ? $"{ClimateDeg(c.CurrentC)} · off"
        : c.TargetC is null ? ClimateDeg(c.CurrentC)
        : $"{ClimateDeg(c.CurrentC)} → {ClimateDeg(c.TargetC)}";

    /// <summary>"Den heat pump: heat, now 21.5°, set 22°"; no name says Climate; a mode's underscore reads as a space; null clauses are dropped.</summary>
    public static string ClimateTip(HomeClimate c)
    {
        var name = Blank(c.Name) ?? "Climate";
        var clauses = Clauses(Blank(c.Mode)?.Replace('_', ' '), c.CurrentC is { } n ? $"now {ClimateDeg(n)}" : null, c.TargetC is { } t ? $"set {ClimateDeg(t)}" : null).ToArray();
        return clauses.Length > 0 ? $"{name}: {string.Join(", ", clauses)}" : name;
    }

    /// <summary>"31 of 33 up".</summary>
    public static string ContainersValue(Containers c) => $"{Int(c.Running)} of {Int(c.Total)} up";

    /// <summary>The single worst issue, "1 dead", else "2 unhealthy", else "1 restarting"; null when there is none.</summary>
    public static string? ContainersIssue(Containers c) =>
        c.Dead > 0 ? $"{Int(c.Dead)} dead" : c.Unhealthy > 0 ? $"{Int(c.Unhealthy)} unhealthy" : c.Restarting > 0 ? $"{Int(c.Restarting)} restarting" : null;

    /// <summary>"33 containers: 31 up, 1 dead, 2 unhealthy"; zero clauses are dropped and one is "1 container".</summary>
    public static string ContainersTip(Containers c) =>
        $"{Int(c.Total)} {(c.Total == 1 ? "container" : "containers")}: " + string.Join(", ", new (int N, string Word)[] { (c.Running, "up"), (c.Dead, "dead"), (c.Unhealthy, "unhealthy"), (c.Restarting, "restarting") }
            .Where(p => p.N > 0).Select(p => $"{Int(p.N)} {p.Word}"));

    /// <summary>The closed header's line, "3 on · 21.5° · 31 up" (worst container issue appended); parts that are hidden or null are dropped, "" when nothing is usable.</summary>
    public static string HomeMeta(Home? home, Containers? containers)
    {
        var h = Home.Usable(home);
        var c = Containers.Usable(containers);
        return string.Join(" · ", Clauses(
            h?.Lights is { } l ? (l.LightsOn == 0 ? "All off" : $"{Int(l.LightsOn)} on") : null,
            h?.Climate?.CurrentC is not null ? ClimateDeg(h.Climate.CurrentC) : null,
            c is not null ? $"{Int(c.Running)} up" : null,
            c is not null ? ContainersIssue(c) : null));
    }

    // --- VITALS (slice 5) ---
    public const string VitalsTitle = "Vitals";
    public const string VitalsCollecting = "Collecting history";
    public const string VitalsUnavailable = "Host vitals unavailable";

    public static string VitalsHeaderTip(bool closed, bool folded) => folded ? SectionFolded : closed ? "Show vitals" : "Hide vitals";

    /// <summary>The closed header's line, "CPU 12% · MEM 34% · DISK 71%" (DISK is the null figure without a reading), or the unavailable line when there are no vitals.</summary>
    /// <remarks>withDisk false drops the DISK clause: a stale or offline header also carries "AS OF hh:mm", and the full line does not fit beside it at 100 / 100 / 100.</remarks>
    public static string VitalsMeta(Vitals? v, bool withDisk = true) => v is null ? VitalsUnavailable
        : $"CPU {VitalsPct(v.Cpu)} · MEM {VitalsPct(v.Mem)}" + (withDisk ? $" · DISK {(v.DiskMax is { } d ? VitalsPct(d) : NullFigure)}" : "");

    /// <summary>"12%": the same Math.Round the caption runs use.</summary>
    public static string VitalsPct(double x) => Math.Round(x).ToString(CultureInfo.InvariantCulture) + "%";

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
