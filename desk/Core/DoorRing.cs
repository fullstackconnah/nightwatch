using System.Text.Json;

namespace NightwatchDesk.Core;

/// <summary>One reading of /kiosk/api/doorbell: whether HA answered, and the newest trigger if any. AgeSec is on the server's clock.</summary>
public sealed record DoorSnapshot(bool Ok, string? Kind, string? FiredAt, double? AgeSec);

/// <summary>What the last good poll saw. LastOk and LastToast are times on the caller's own clock.</summary>
public sealed record DoorState(string? FiredAt = null, TimeSpan? LastOk = null, TimeSpan? LastToast = null);

public static class DoorParser
{
    /// <summary>Null for anything that is not a doorbell object; never throws.</summary>
    public static DoorSnapshot? Parse(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var r = doc.RootElement;
            if (r.ValueKind != JsonValueKind.Object) return null;
            var ok = r.TryGetProperty("status", out var s) && s.ValueKind == JsonValueKind.String && s.GetString() == "ok";
            if (!r.TryGetProperty("latest", out var l) || l.ValueKind != JsonValueKind.Object) return new DoorSnapshot(ok, null, null, null);
            return new DoorSnapshot(ok, Str(l, "kind"), Str(l, "firedAt"),
                l.TryGetProperty("ageSec", out var a) && a.ValueKind == JsonValueKind.Number && a.TryGetDouble(out var d) ? d : null);
        }
        catch (JsonException) { return null; }
    }

    static string? Str(JsonElement o, string n) => o.TryGetProperty(n, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
}

/// <summary>The kiosk's rule (a fresh ring only; a fresh mount never replays an old one), as a pure step.</summary>
public static class DoorRing
{
    public const double FreshSec = 45;
    public static readonly TimeSpan Gap = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Feed one successful poll. The first poll, and the first after a gap over 30 s, only record a baseline.
    /// A toast needs a new <c>firedAt</c>, an age of at most 45 s, and 30 s since the last toast.
    /// </summary>
    public static (DoorState State, Toast? Toast) Next(DoorState s, DoorSnapshot snap, TimeSpan now, string baseUrl)
    {
        var baseline = s.LastOk is not { } last || now - last > Gap;
        var fired = snap.Ok && snap.FiredAt is not null ? snap.FiredAt : s.FiredAt;
        var next = s with { FiredAt = fired, LastOk = now };
        if (baseline || !snap.Ok || snap.FiredAt is null || snap.FiredAt == s.FiredAt || snap.AgeSec is not { } age || age > FreshSec) return (next, null);
        if (s.LastToast is { } t && now - t < Gap) return (next, null);
        return (next with { LastToast = now }, Copy.DoorToast(snap.Kind, baseUrl));
    }
}
