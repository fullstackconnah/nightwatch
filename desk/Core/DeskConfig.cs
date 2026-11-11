using System.Text.Json;

namespace NightwatchDesk.Core;

public abstract record ConfigResult
{
    // The token is never part of ToString, so a logged result cannot leak it.
    public sealed record Ok(string BaseUrl, string Token, int CameraIntervalSeconds = DeskConfig.DefaultCameraInterval) : ConfigResult
    {
        public override string ToString() => $"Ok {{ BaseUrl = {BaseUrl} }}";
    }
    public sealed record Missing : ConfigResult;
    public sealed record Unreadable(int Line) : ConfigResult;
    public sealed record TokenMissing : ConfigResult;
    public sealed record BadAddress : ConfigResult;
}

public static class DeskConfig
{
    public static ConfigResult Load(string path)
    {
        string text;
        try
        {
            if (!File.Exists(path)) return new ConfigResult.Missing();
            text = File.ReadAllText(path);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return new ConfigResult.Unreadable(1); // shortcut: no line to report for an IO failure, so line 1
        }
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return new ConfigResult.Unreadable(1);
            var token = Str(root, "token")?.Trim();
            if (string.IsNullOrEmpty(token) || token == "REPLACE_ME") return new ConfigResult.TokenMissing();
            var baseUrl = Str(root, "baseUrl")?.Trim().TrimEnd('/');
            if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
                return new ConfigResult.BadAddress();
            return new ConfigResult.Ok(baseUrl!, token, CameraInterval(root));
        }
        catch (JsonException e)
        {
            return new ConfigResult.Unreadable((int)(e.LineNumber ?? 0) + 1); // LineNumber is zero-based
        }
    }

    public const int DefaultCameraInterval = 30;

    /// <summary>cameraIntervalSeconds clamped to 5-300; absent or not a number gives 30.</summary>
    static int CameraInterval(JsonElement o) =>
        o.TryGetProperty("cameraIntervalSeconds", out var p) && p.ValueKind == JsonValueKind.Number && p.TryGetDouble(out var d)
            ? (int)Math.Clamp(Math.Round(d), 5, 300)
            : DefaultCameraInterval;

    static string? Str(JsonElement o, string name) =>
        o.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
}
