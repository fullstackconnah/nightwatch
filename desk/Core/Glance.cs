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
// Forecast is read apart from the rest (see GlanceParser): a bad forecast must never fail the whole glance.
public sealed record Glance(int V, DateTimeOffset CheckedAt, string Tone, string Answer, GlanceItem[] Lanes, GlanceItem[] Items, Probes Probes, Vitals? Vitals, WeatherNow? Weather = null, bool Camera = false, [property: JsonIgnore] ForecastDay[]? Forecast = null);

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
            return n == 1 && g is not null && Complete(g) ? new Outcome.Ok(g with { Forecast = ReadForecast(root) }) : new Outcome.Failed();
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or NotSupportedException or ArgumentException)
        {
            return new Outcome.Failed();
        }
    }

    static ForecastDay[]? ReadForecast(JsonElement root)
    {
        try { return root.TryGetProperty("forecast", out var f) ? f.Deserialize<ForecastDay[]>(Options) : null; }
        catch (Exception e) when (e is JsonException or InvalidOperationException or NotSupportedException) { return null; }
    }

    // A missing required key deserializes to null; treat that as a bad body rather than crash later.
    static bool Complete(Glance g) =>
        g.CheckedAt != default && g.Tone is not null && g.Answer is not null && g.Probes is not null &&
        g.Lanes is not null && g.Items is not null && g.Lanes.Concat(g.Items).All(i => i is { Id: not null, Headline: not null, Href: not null, Severity: not null });
}
