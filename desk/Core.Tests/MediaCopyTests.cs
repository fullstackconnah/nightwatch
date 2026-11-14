using System.Globalization;
using NightwatchDesk.Core;

namespace Core.Tests;

public class MediaCopyTests
{
    static NowPlaying Np(string state = "playing", string? subtitle = null, string? app = null) => new("The Lighthouse Keeper", subtitle, app, state, null);
    static DownloadItem Dl(double? p, double? speed, double? eta = null) => new("Field Recordings Vol 3", p, speed, eta);

    [Fact]
    public void MediaMeta_joins_the_play_state_and_the_download_count()
    {
        Assert.Equal("Playing · 2 downloading", Copy.MediaMeta(Np(), 2));
        Assert.Equal("Paused", Copy.MediaMeta(Np("paused"), 0));
        Assert.Equal("2 downloading", Copy.MediaMeta(null, 2));
        Assert.Equal("", Copy.MediaMeta(null, 0));
        Assert.Equal("", Copy.MediaMeta(Np("buffering"), 0));
    }

    [Fact]
    public void NowPlayingLine2_drops_missing_clauses_and_prefixes_paused()
    {
        Assert.Equal("Harbour Lights · Jellyfin", Copy.NowPlayingLine2(Np(subtitle: "Harbour Lights", app: "Jellyfin")));
        Assert.Equal("Paused · Jellyfin", Copy.NowPlayingLine2(Np("paused", app: "Jellyfin")));
        Assert.Equal("Playing", Copy.NowPlayingLine2(Np()));
        Assert.Equal("Paused", Copy.NowPlayingLine2(Np("paused")));
        Assert.Equal("Jellyfin", Copy.NowPlayingLine2(Np(subtitle: " ", app: "Jellyfin")));
    }

    [Fact]
    public void NowPlayingTip_is_the_title_then_line_two()
        => Assert.Equal("The Lighthouse Keeper\nHarbour Lights · Jellyfin", Copy.NowPlayingTip(Np(subtitle: "Harbour Lights", app: "Jellyfin")));

    [Theory]
    [InlineData(0.43, 2100000, "43% · 2.1 MB/s")]
    [InlineData(0.08, 640000, "8% · 640 KB/s")]
    [InlineData(0, 512, "0% · 512 B/s")]
    [InlineData(0.995, 125000000, "99% · 125.0 MB/s")]
    [InlineData(0.29, 0, "29% · stalled")]
    [InlineData(1.0, 2100000, "100% · 2.1 MB/s")]
    [InlineData(1.7, 2100000, "100% · 2.1 MB/s")]
    [InlineData(-1, 2100000, "0% · 2.1 MB/s")]
    [InlineData(double.NaN, 2100000, "0% · 2.1 MB/s")]
    [InlineData(0.5, double.NaN, "50% · stalled")]
    [InlineData(0.5, 999500, "50% · 1.0 MB/s")]
    public void DownloadRight_formats_percent_and_speed(double p, double speed, string expected)
        => Assert.Equal(expected, Copy.DownloadRight(Dl(p, speed)));

    [Fact]
    public void DownloadRight_reads_missing_figures_as_zero_and_stalled()
        => Assert.Equal("0% · stalled", Copy.DownloadRight(Dl(null, null)));

    [Fact]
    public void Percent_is_floored_so_100_means_done()
        => Assert.Equal("28% · stalled", Copy.DownloadRight(Dl(0.2899999999, 0)));

    [Theory]
    [InlineData(720.0, "Field Recordings Vol 3, 43%, about 12 min left")]
    [InlineData(30.0, "Field Recordings Vol 3, 43%, less than a minute left")]
    [InlineData(7200.0, "Field Recordings Vol 3, 43%, about 2 h left")]
    [InlineData(null, "Field Recordings Vol 3, 43%")]
    [InlineData(0.0, "Field Recordings Vol 3, 43%")]
    [InlineData(-4.0, "Field Recordings Vol 3, 43%")]
    public void DownloadTip_says_how_long_is_left(double? eta, string expected)
        => Assert.Equal(expected, Copy.DownloadTip(Dl(0.43, 2100000, eta)));

    [Fact]
    public void DownloadTip_says_stalled_at_speed_zero()
        => Assert.Equal("Field Recordings Vol 3, 43%, stalled", Copy.DownloadTip(Dl(0.43, 0, 720)));

    [Fact]
    public void MediaHeaderTip_folded_closed_open()
    {
        Assert.Equal(Copy.SectionFolded, Copy.MediaHeaderTip(false, true));
        Assert.Equal("Show media", Copy.MediaHeaderTip(true, false));
        Assert.Equal("Hide media", Copy.MediaHeaderTip(false, false));
    }

    [Fact]
    public void Formatting_ignores_the_current_culture()
    {
        var old = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("de-DE");
            Assert.Equal("43% · 2.1 MB/s", Copy.DownloadRight(Dl(0.43, 2100000)));
            Assert.Equal("Playing · 2 downloading", Copy.MediaMeta(Np(), 2));
        }
        finally { CultureInfo.CurrentCulture = old; }
    }
}
