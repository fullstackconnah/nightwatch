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
// Forecast, NowPlaying and Downloads are read apart from the rest (see GlanceParser): a bad one must never fail the whole glance.
public sealed record Glance(int V, DateTimeOffset CheckedAt, string Tone, string Answer, GlanceItem[] Lanes, GlanceItem[] Items, Probes Probes, Vitals? Vitals, WeatherNow? Weather = null, bool Camera = false, [property: JsonIgnore] ForecastDay[]? Forecast = null, [property: JsonIgnore] NowPlaying? NowPlaying = null, [property: JsonIgnore] Downloads? Downloads = null);

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
            return n == 1 && g is not null && Complete(g) ? new Outcome.Ok(g with { Forecast = ReadForecast(root), NowPlaying = ReadNowPlaying(root), Downloads = ReadDownloads(root) }) : new Outcome.Failed();
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
