using System.Text.Json;
using System.Text.Json.Serialization;

namespace NightwatchDesk.Core;

// Mirrors src/lib/desk-glance.ts (v1). Optional fields are missing on the wire when unset.
public sealed record GlanceItem(string Id, string Severity, string Headline, string? Detail, string? Action, string? Since, string Href);
public sealed record Probes(int Answered, int Failed, int Pending)
{
    public int Total => Answered + Failed + Pending;
}
public sealed record Vitals(double Cpu, double Mem, double? DiskMax);
public sealed record WeatherNow(double? TempC, double? FeelsC, string? Label, double? HighC, double? LowC, double? RainPct, string? Icon);
public sealed record ForecastDay(string? Day, string? Icon, double? HighC, double? LowC, double? RainPct)
{
    /// <summary>What the strip may show: entries whose day parses, at most 4. Null reads as empty. Never throws.</summary>
    public static ForecastDay[] Usable(ForecastDay[]? f) =>
        (f ?? []).Where(d => d is not null && Copy.ForecastDate(d.Day) is not null).Take(4).ToArray();
}
/// <summary>State is "playing" or "paused" on the wire; anything else is not shown.</summary>
public sealed record NowPlaying(string? Title, string? Subtitle, string? AppName, string? State, double? Progress01)
{
    /// <summary>What the row may show: null for a blank title or a state other than playing or paused; strings cut to the server's caps again (80, 80, 24). Never throws.</summary>
    public static NowPlaying? Usable(NowPlaying? n) =>
        n is { Title: { } t, State: "playing" or "paused" } && !string.IsNullOrWhiteSpace(t)
            ? n with { Title = Copy.Trim(t, 80), Subtitle = n.Subtitle is { } s ? Copy.Trim(s, 80) : null, AppName = n.AppName is { } a ? Copy.Trim(a, 24) : null }
            : null;
}
public sealed record DownloadItem(string? Name, double? Progress, double? SpeedBps, double? EtaS);
/// <summary>Count is every downloading item; Items the first 3 at most.</summary>
public sealed record Downloads(int Count, DownloadItem[] Items);
/// <summary>Lights on of lights total (the kiosk-visible ones). Counts only, no names.</summary>
public sealed record HomeLights(int LightsOn, int LightsTotal)
{
    /// <summary>Null unless there is at least one light and 0 &lt;= on &lt;= total. Never throws.</summary>
    public static HomeLights? Usable(HomeLights? l) => l is { LightsTotal: > 0, LightsOn: >= 0 } && l.LightsOn <= l.LightsTotal ? l : null;
}
/// <summary>The first available climate: Mode is the HVAC mode, temperatures are Celsius, Name may be missing.</summary>
public sealed record HomeClimate(string? Name, string? Mode, double? CurrentC, double? TargetC)
{
    static double? Plausible(double? t) => t is { } v && double.IsFinite(v) && v is >= -50 and <= 60 ? v : null;

    /// <summary>Null for a blank mode; temperatures outside -50..60 read null; name cut to 24, mode to 12 (the server's caps, again). Never throws.</summary>
    public static HomeClimate? Usable(HomeClimate? c) =>
        c is { Mode: { } m } && !string.IsNullOrWhiteSpace(m)
            ? new(string.IsNullOrWhiteSpace(c.Name) ? null : Copy.Trim(c.Name, 24), Copy.Trim(m, 12), Plausible(c.CurrentC), Plausible(c.TargetC))
            : null;
}
public sealed record Home(HomeLights? Lights, HomeClimate? Climate)
{
    /// <summary>Each part through its own Usable; null when neither survives. Never throws.</summary>
    public static Home? Usable(Home? h) =>
        h is not null && new Home(HomeLights.Usable(h.Lights), HomeClimate.Usable(h.Climate)) is { } u && (u.Lights is not null || u.Climate is not null) ? u : null;
}
/// <summary>Container counts: no names. Running and Total are the "31 of 33 up" figures.</summary>
public sealed record Containers(int Total, int Running, int Restarting, int Unhealthy, int Dead)
{
    /// <summary>Null unless all five are non-negative, Total &gt; 0 and Running &lt;= Total. Never throws.</summary>
    public static Containers? Usable(Containers? c) =>
        c is { Total: > 0, Running: >= 0, Restarting: >= 0, Unhealthy: >= 0, Dead: >= 0 } && c.Running <= c.Total ? c : null;
}
// Forecast, NowPlaying, Downloads, Home and Containers are read apart from the rest (see GlanceParser): a bad one must never fail the whole glance.
public sealed record Glance(int V, DateTimeOffset CheckedAt, string Tone, string Answer, GlanceItem[] Lanes, GlanceItem[] Items, Probes Probes, Vitals? Vitals, WeatherNow? Weather = null, bool Camera = false, [property: JsonIgnore] ForecastDay[]? Forecast = null, [property: JsonIgnore] NowPlaying? NowPlaying = null, [property: JsonIgnore] Downloads? Downloads = null, [property: JsonIgnore] Home? Home = null, [property: JsonIgnore] Containers? Containers = null);

/// <summary>What one poll came back with. The HTTP layer maps its result onto these.</summary>
public abstract record Outcome
{
    public sealed record Ok(Glance Glance) : Outcome;
    /// <summary>HTTP 401.</summary>
    public sealed record Unauthorized : Outcome;
    /// <summary>HTTP 503.</summary>
    public sealed record Off : Outcome;
    public sealed record TooNew(int V) : Outcome;
    /// <summary>Network error, timeout, 5xx or a body that does not parse.</summary>
    public sealed record Failed : Outcome;
}

public static class GlanceParser
{
    static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    /// <summary>Ok, TooNew (v above 1, body not read further) or Failed. Never throws.</summary>
    public static Outcome Parse(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("v", out var v) || v.ValueKind != JsonValueKind.Number || !v.TryGetInt32(out var n))
                return new Outcome.Failed();
            if (n > 1) return new Outcome.TooNew(n);
            var g = root.Deserialize<Glance>(Options);
            return n == 1 && g is not null && Complete(g) ? new Outcome.Ok(g with { Forecast = ReadForecast(root), NowPlaying = ReadNowPlaying(root), Downloads = ReadDownloads(root), Home = ReadHome(root), Containers = ReadObject<Containers>(root, "containers") }) : new Outcome.Failed();
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or NotSupportedException or ArgumentException)
        {
            return new Outcome.Failed();
        }
    }

    static ForecastDay[]? ReadForecast(JsonElement root)
    {
        // At most 4 entries are read, never the whole array (the server sends 4).
        try { return root.TryGetProperty("forecast", out var f) && f.ValueKind == JsonValueKind.Array ? f.EnumerateArray().Take(4).Select(e => e.Deserialize<ForecastDay>(Options)!).ToArray() : null; }
        catch (Exception e) when (e is JsonException or InvalidOperationException or NotSupportedException) { return null; }
    }

    static NowPlaying? ReadNowPlaying(JsonElement root)
    {
        try { return root.TryGetProperty("nowPlaying", out var n) && n.ValueKind == JsonValueKind.Object ? n.Deserialize<NowPlaying>(Options) : null; }
        catch (Exception e) when (e is JsonException or InvalidOperationException or NotSupportedException) { return null; }
    }

    // The Web defaults read "3" as a number; these two are strict, so a string where a count belongs is a wrong type.
    static readonly JsonSerializerOptions Strict = new(JsonSerializerDefaults.Web) { NumberHandling = JsonNumberHandling.Strict };

    // An object or nothing: a missing key, a null, a non-object or a wrongly typed member (the whole object) reads null.
    static T? ReadObject<T>(JsonElement root, string key) where T : class
    {
        try { return root.TryGetProperty(key, out var e) && e.ValueKind == JsonValueKind.Object ? e.Deserialize<T>(Strict) : null; }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or NotSupportedException) { return null; }
    }

    // Lights and climate are read apart, so a wrongly typed one is null and the other survives; null when neither reads.
    static Home? ReadHome(JsonElement root)
    {
        if (!root.TryGetProperty("home", out var h) || h.ValueKind != JsonValueKind.Object) return null;
        var lights = ReadObject<HomeLights>(h, "lights");
        var climate = ReadObject<HomeClimate>(h, "climate");
        return lights is null && climate is null ? null : new Home(lights, climate);
    }

    // Any wrongly typed item makes the whole field null; a non-array "items" is empty; a bad "count" reads 0.
    static Downloads? ReadDownloads(JsonElement root)
    {
        try
        {
            if (!root.TryGetProperty("downloads", out var d) || d.ValueKind != JsonValueKind.Object) return null;
            var count = d.TryGetProperty("count", out var c) && c.ValueKind == JsonValueKind.Number && c.TryGetInt32(out var n) && n >= 0 ? n : 0;
            var items = d.TryGetProperty("items", out var i) && i.ValueKind == JsonValueKind.Array
                ? i.EnumerateArray().Take(3).Select(e => e.Deserialize<DownloadItem>(Options) ?? throw new JsonException())
                    .Where(x => !string.IsNullOrWhiteSpace(x.Name)).Select(x => x with { Name = Copy.Trim(x.Name!, 60) }).ToArray()
                : [];
            return new Downloads(Math.Max(count, items.Length), items);
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or NotSupportedException) { return null; }
    }

    // A missing required key deserializes to null; treat that as a bad body rather than crash later.
    static bool Complete(Glance g) =>
        g.CheckedAt != default && g.Tone is not null && g.Answer is not null && g.Probes is not null &&
        g.Lanes is not null && g.Items is not null && g.Lanes.Concat(g.Items).All(i => i is { Id: not null, Headline: not null, Href: not null, Severity: not null });
}
