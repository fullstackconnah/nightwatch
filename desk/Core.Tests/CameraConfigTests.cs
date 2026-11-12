using NightwatchDesk.Core;

namespace Core.Tests;

public class GlanceCameraWeatherTests
{
    static string Legacy() => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fixtures", "glance.v1-legacy.json"));

    [Fact]
    public void Legacy_fixture_parses_with_camera_false_and_weather_null()
    {
        var g = ((Outcome.Ok)GlanceParser.Parse(Legacy())).Glance;
        Assert.False(g.Camera);
        Assert.Null(g.Weather);
    }

    [Fact]
    public void New_fixture_parses_weather_and_camera()
    {
        var g = GlanceTests.Golden();
        Assert.True(g.Camera);
        Assert.Equal(new WeatherNow(21.4, 19.9, "Partly cloudy", 25, 14, 60, "partly-cloudy"), g.Weather);
    }

    [Fact]
    public void An_unknown_weather_key_is_ignored_and_each_field_may_be_null()
    {
        var json = GlanceTests.Fixture().Replace("\"weather\": {", "\"weather\": {\"wind\": 3,");
        Assert.Equal(GlanceTests.Golden().Weather, ((Outcome.Ok)GlanceParser.Parse(json)).Glance.Weather);
        foreach (var f in new[] { "TempC", "FeelsC", "Label", "HighC", "LowC", "RainPct", "Icon" })
        {
            var doc = System.Text.Json.Nodes.JsonNode.Parse(GlanceTests.Fixture())!;
            doc["weather"]![char.ToLowerInvariant(f[0]) + f[1..]] = null;
            var w = ((Outcome.Ok)GlanceParser.Parse(doc.ToJsonString())).Glance.Weather!;
            Assert.Null(typeof(WeatherNow).GetProperty(f)!.GetValue(w));
        }
    }
}

public class CameraConfigTests : IDisposable
{
    readonly string dir = Directory.CreateTempSubdirectory("nwdesk").FullName;
    public void Dispose() => Directory.Delete(dir, true);

    int Interval(string? extra)
    {
        var p = Path.Combine(dir, "desk.json");
        File.WriteAllText(p, "{\"baseUrl\":\"http://h:1\",\"token\":\"tok_AbCdEf0123456789AbCdEf0123456789\"" + (extra is null ? "" : "," + extra) + "}");
        return ((ConfigResult.Ok)DeskConfig.Load(p)).CameraIntervalSeconds;
    }

    [Theory]
    [InlineData(null, 30)]
    [InlineData("\"cameraIntervalSeconds\":1", 5)]
    [InlineData("\"cameraIntervalSeconds\":5", 5)]
    [InlineData("\"cameraIntervalSeconds\":30", 30)]
    [InlineData("\"cameraIntervalSeconds\":300", 300)]
    [InlineData("\"cameraIntervalSeconds\":9999", 300)]
    [InlineData("\"cameraIntervalSeconds\":-4", 5)]
    [InlineData("\"cameraIntervalSeconds\":\"10\"", 30)]
    [InlineData("\"cameraIntervalSeconds\":null", 30)]
    public void Camera_interval_defaults_to_30_and_clamps_to_5_300(string? extra, int want) => Assert.Equal(want, Interval(extra));

    [Theory]
    [InlineData(null, true)]
    [InlineData("\"doorToasts\":true", true)]
    [InlineData("\"doorToasts\":false", false)]
    [InlineData("\"doorToasts\":\"false\"", true)]
    [InlineData("\"doorToasts\":0", true)]
    [InlineData("\"doorToasts\":null", true)]
    public void DoorToasts_defaults_to_true_and_only_a_real_false_turns_it_off(string? extra, bool want)
    {
        var p = Path.Combine(dir, "desk.json");
        File.WriteAllText(p, "{\"baseUrl\":\"http://h:1\",\"token\":\"tok_AbCdEf0123456789AbCdEf0123456789\"" + (extra is null ? "" : "," + extra) + "}");
        Assert.Equal(want, ((ConfigResult.Ok)DeskConfig.Load(p)).DoorToasts);
    }
}
