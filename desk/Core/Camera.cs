using System.Net.Http.Headers;
using System.Text.Json;

namespace NightwatchDesk.Core;

/// <summary>What one camera fetch came back with. Failures carry nothing: no status, no text, no bytes in a log.</summary>
public abstract record FrameOutcome
{
    /// <summary>Headers are acceptable (200, a small jpeg or png); the body is not read yet.</summary>
    public sealed record Image : FrameOutcome;
    public sealed record Frame(byte[] Bytes) : FrameOutcome;
    /// <summary>401, 404, 502, 503, a timeout, a network error, over the cap or not an image.</summary>
    public sealed record Failure : FrameOutcome;
}

public static class CameraFrame
{
    public const int MaxBytes = 1_572_864; // 1.5 MiB
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

    /// <summary>Pure: only a 200 with image/jpeg or image/png and a declared length within the cap is acceptable.</summary>
    public static FrameOutcome Map(int status, string? contentType, long? length)
    {
        var type = contentType?.Split(';')[0].Trim().ToLowerInvariant();
        var ok = status == 200 && type is "image/jpeg" or "image/png" && (length is null || length <= MaxBytes);
        return ok ? new FrameOutcome.Image() : new FrameOutcome.Failure();
    }

    /// <summary>One GET of the door camera. Never throws; the cap is enforced while reading, so an unlabelled body cannot exceed it.</summary>
    public static async Task<FrameOutcome> FetchAsync(HttpClient http, string baseUrl, string token, CancellationToken ct = default)
    {
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(Timeout);
            using var req = new HttpRequestMessage(HttpMethod.Get, baseUrl + "/api/desk/camera");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token).ConfigureAwait(false);
            if (Map((int)resp.StatusCode, resp.Content.Headers.ContentType?.ToString(), resp.Content.Headers.ContentLength) is not FrameOutcome.Image)
                return new FrameOutcome.Failure();
            await using var body = await resp.Content.ReadAsStreamAsync(cts.Token).ConfigureAwait(false);
            var buf = new MemoryStream();
            var chunk = new byte[16 * 1024];
            int n;
            while ((n = await body.ReadAsync(chunk, cts.Token).ConfigureAwait(false)) > 0)
            {
                if (buf.Length + n > MaxBytes) return new FrameOutcome.Failure();
                buf.Write(chunk, 0, n);
            }
            return buf.Length == 0 ? new FrameOutcome.Failure() : new FrameOutcome.Frame(buf.ToArray());
        }
        catch (Exception)
        {
            return new FrameOutcome.Failure();
        }
    }
}

public enum FrameState { Loading, Live, Stale, NoPicture }

/// <summary>Frame age rules (SHAPE "Frame states"). I is the fetch interval in seconds.</summary>
public static class FrameClock
{
    static double NoPictureAfter(int i) => Math.Max(300, 3.0 * i);

    /// <summary>
    /// Live to 2I, Stale to max(300 s, 3I), then NoPicture. With no frame: NoPicture once a fetch has failed, else Loading.
    /// <paramref name="fetchInFlight"/> does not change the answer (Loading shows before and during the first fetch); kept for the caller's signature.
    /// </summary>
    public static FrameState Compute(DateTimeOffset now, DateTimeOffset? lastFrameAt, int i, bool fetchInFlight, bool everFailedWithoutFrame)
    {
        if (lastFrameAt is not { } last) return everFailedWithoutFrame ? FrameState.NoPicture : FrameState.Loading;
        var a = (now - last).TotalSeconds;
        return a <= 2.0 * i ? FrameState.Live : a < NoPictureAfter(i) ? FrameState.Stale : FrameState.NoPicture;
    }

    /// <summary>On resume a kept frame at or past the NoPicture threshold is dropped, so no hours-old picture shows.</summary>
    public static bool DropOnResume(DateTimeOffset now, DateTimeOffset lastFrameAt, int i) =>
        (now - lastFrameAt).TotalSeconds >= NoPictureAfter(i);
}

/// <summary>
/// Whether the camera block exists at all. Feed it once per poll outcome (not per render, or a false would count twice).
/// Hidden until the first true; once shown, hides on the 3rd false in a row; Failed (stale/offline) counts nothing; a client error hides at once.
/// </summary>
public sealed class CameraVisibility
{
    public const int HideAfterFalses = 3;
    int falses;

    public bool Visible { get; private set; }

    public void OnPoll(Outcome o)
    {
        switch (o)
        {
            case Outcome.Ok { Glance.Camera: true }:
                Visible = true; falses = 0;
                break;
            case Outcome.Ok:
                if (Visible && ++falses >= HideAfterFalses) { Visible = false; falses = 0; }
                break;
            case Outcome.Failed:
                break;
            default: // Unauthorized, Off, TooNew
                Visible = false; falses = 0;
                break;
        }
    }
}

public static class FrameGate
{
    /// <summary>False while the window is hidden or minimised, the block is collapsed, folded or hidden, the view is a client error, the session is locked or the PC is suspended.</summary>
    public static bool ShouldFetch(bool windowHidden, bool blockHidden, bool clientError, bool sessionLocked, bool suspended) =>
        !(windowHidden || blockHidden || clientError || sessionLocked || suspended);
}

/// <summary>The desk's own memory in state.json that the camera adds. Unknown keys (the window's position) are ignored on read.</summary>
public sealed record DeskMemory(bool CameraCollapsed = false)
{
    static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    public static DeskMemory Parse(string? json)
    {
        try { return string.IsNullOrWhiteSpace(json) ? new DeskMemory() : JsonSerializer.Deserialize<DeskMemory>(json, Options) ?? new DeskMemory(); }
        catch (JsonException) { return new DeskMemory(); }
    }

    public string ToJson() => JsonSerializer.Serialize(this, Options);
}
