using NightwatchDesk.Core;

namespace Core.Tests;

public class VitalsCopyTests
{
    [Fact]
    public void Vitals_meta_prints_the_three_figures()
    {
        Assert.Equal("CPU 12% · MEM 34% · DISK 71%", Copy.VitalsMeta(new Vitals(12, 34, 71)));
        Assert.Equal("CPU 12% · MEM 34% · DISK —", Copy.VitalsMeta(new Vitals(12, 34, null)));
        Assert.Equal("Host vitals unavailable", Copy.VitalsMeta(null));
    }

    [Fact]
    public void Vitals_meta_can_drop_the_disk_clause()
    {
        Assert.Equal("CPU 12% · MEM 34%", Copy.VitalsMeta(new Vitals(12, 34, 71), withDisk: false));
        Assert.Equal("Host vitals unavailable", Copy.VitalsMeta(null, withDisk: false));
    }

    [Fact]
    public void Vitals_meta_rounds_like_the_caption()
    {
        Assert.Equal("CPU 100% · MEM 0% · DISK 100%", Copy.VitalsMeta(new Vitals(99.6, 0.4, 99.5)));
    }

    [Fact]
    public void Vitals_header_tip_follows_the_other_sections()
    {
        Assert.Equal("Hide vitals", Copy.VitalsHeaderTip(false, false));
        Assert.Equal("Show vitals", Copy.VitalsHeaderTip(true, false));
        Assert.Equal(Copy.SectionFolded, Copy.VitalsHeaderTip(false, true));
        Assert.Equal(Copy.SectionFolded, Copy.VitalsHeaderTip(true, true));
    }

    [Fact]
    public void Vitals_fixed_strings()
    {
        Assert.Equal("Collecting history", Copy.VitalsCollecting);
        Assert.Equal("Host vitals unavailable", Copy.VitalsUnavailable);
        Assert.Equal("VITALS", Copy.VitalsTitle.ToUpperInvariant());
    }
}
