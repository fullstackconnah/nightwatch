using System.Globalization;
using NightwatchDesk.Core;

namespace Core.Tests;

public class CameraCopyTests
{
    static WeatherNow W(double? t = 21.6, double? f = 19.5, string? label = "Partly cloudy", double? h = 25, double? l = 14, double? r = 60, string? icon = "clear")
        => new(t, f, label, h, l, r, icon);

    [Fact]
    public void Rounding_is_half_up_not_bankers()
    {
        Assert.Equal("0°", Copy.WeatherTemp(W(t: -0.5)));
        Assert.Equal("3°", Copy.WeatherTemp(W(t: 2.5)));
        Assert.Equal("-3°", Copy.WeatherTemp(W(t: -2.6)));
        Assert.Equal("feels 20°", Copy.WeatherLine2(W(h: null, l: null, r: null)));
    }

    [Fact]
    public void Line_1_parts_and_null_figure()
    {
        Assert.Equal("22°", Copy.WeatherTemp(W()));
        Assert.Equal("Partly cloudy", Copy.WeatherLabel(W()));
        Assert.Equal("—", Copy.WeatherTemp(W(t: null)));
        Assert.Equal("", Copy.WeatherLabel(W(label: null)));
    }

    [Fact]
    public void Line_2_drops_null_clauses_with_their_separator()
    {
        Assert.Equal("feels 20° · H 25° · L 14° · 60% rain", Copy.WeatherLine2(W()));
        Assert.Equal("H 25° · 60% rain", Copy.WeatherLine2(W(f: null, l: null)));
        Assert.Equal("L 14°", Copy.WeatherLine2(W(f: null, h: null, r: null)));
        Assert.Equal("", Copy.WeatherLine2(W(f: null, h: null, l: null, r: null)));
    }

    [Fact]
    public void Line_2_worst_case_is_39_characters()
    {
        var s = Copy.WeatherLine2(W(f: -10, h: -2, l: -15, r: 100));
        Assert.Equal("feels -10° · H -2° · L -15° · 100% rain", s);
        Assert.Equal(39, s.Length);
    }

    [Fact]
    public void Tooltip_is_the_full_sentence_and_drops_null_clauses_with_their_comma()
    {
        Assert.Equal("Partly cloudy, 22°, feels like 20°. High 25°, low 14°, 60% chance of rain.", Copy.WeatherTooltip(W()));
        Assert.Equal("22°. High 25°.", Copy.WeatherTooltip(W(label: null, f: null, l: null, r: null)));
        Assert.Equal("Partly cloudy, 22°, feels like 20°.", Copy.WeatherTooltip(W(h: null, l: null, r: null)));
        Assert.Equal("", Copy.WeatherTooltip(W(t: null, f: null, label: null, h: null, l: null, r: null)));
    }

    [Theory]
    [InlineData("clear", "sun")]
    [InlineData("partly-cloudy", "cloud-sun")]
    [InlineData("cloudy", "cloud")]
    [InlineData("fog", "cloud-fog")]
    [InlineData("drizzle", "cloud-drizzle")]
    [InlineData("rain", "cloud-rain")]
    [InlineData("snow", "cloud-snow")]
    [InlineData("showers", "cloud-rain-wind")]
    [InlineData("thunderstorm", "cloud-lightning")]
    [InlineData("tornado", "cloud")]
    [InlineData("", "cloud")]
    [InlineData(null, "cloud")]
    public void Icon_maps_to_a_glyph_key_and_unknown_is_cloud(string? icon, string glyph) => Assert.Equal(glyph, Copy.GlyphKey(icon));

    [Fact]
    public void Age_clock_is_24_hour_invariant()
    {
        Assert.Equal("14:05:32", Copy.AgeClock(new DateTime(2026, 1, 1, 14, 5, 32)));
        Assert.Equal("04:05:09", Copy.AgeClock(new DateTime(2026, 1, 1, 4, 5, 9)));
        var old = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("ar-SA");
            Assert.Equal("14:05:32", Copy.AgeClock(new DateTime(2026, 1, 1, 14, 5, 32)));
        }
        finally { CultureInfo.CurrentCulture = old; }
    }

    [Fact]
    public void Camera_strings_match_the_shape()
    {
        var t = new DateTime(2026, 1, 1, 14, 5, 32);
        Assert.Equal("Front door", Copy.CameraTitle);
        Assert.Equal("as of 14:05:32", Copy.FrameAge(t));
        Assert.Equal("Waking the camera…", Copy.CameraLoading);
        Assert.Equal("No picture", Copy.CameraNoPicture);
        Assert.Equal("Last frame at 14:05:32", Copy.CameraLastFrame(t));
        Assert.Equal("No frame from the camera yet", Copy.CameraLastFrame(null));
        Assert.Equal("Hidden to fit the screen", Copy.CameraFolded);
        Assert.Equal("Hide the camera", Copy.CameraHeaderTip(false, false));
        Assert.Equal("Show the camera", Copy.CameraHeaderTip(true, false));
        Assert.Equal("There is no room for the picture on this screen right now. It comes back when there is.", Copy.CameraHeaderTip(false, true));
        Assert.Equal("Open the kiosk to watch live", Copy.CameraFrameTip);
        Assert.Equal("Front door camera", Copy.CameraHeaderName);
        Assert.Equal("Front door camera, as of 14:05:32. Opens the kiosk.", Copy.CameraFrameName(FrameState.Live, t));
        Assert.Equal("Front door camera, as of 14:05:32. Opens the kiosk.", Copy.CameraFrameName(FrameState.Stale, t));
        Assert.Equal("Front door camera, waking. Opens the kiosk.", Copy.CameraFrameName(FrameState.Loading, null));
        Assert.Equal("Front door camera, no picture. Opens the kiosk.", Copy.CameraFrameName(FrameState.NoPicture, t));
    }
}
