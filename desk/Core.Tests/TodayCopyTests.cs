using System.Globalization;
using NightwatchDesk.Core;

namespace Core.Tests;

public class TodayCopyTests
{
    static readonly DateTimeOffset At = new(2026, 1, 1, 14, 5, 0, TimeSpan.Zero);

    [Fact]
    public void Date_and_clock_are_invariant_and_use_the_widget_zone()
    {
        Assert.Equal("THU 1 JAN", Copy.TodayDate(At, TimeZoneInfo.Utc));
        Assert.Equal("14:05", Copy.Clock(At, TimeZoneInfo.Utc));
        Assert.Equal("Today, Thursday 1 January, 14:05", Copy.TodayName(At, TimeZoneInfo.Utc));
        var old = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("ar-SA");
            Assert.Equal("THU 1 JAN", Copy.TodayDate(At, TimeZoneInfo.Utc));
            Assert.Equal("14:05", Copy.Clock(At, TimeZoneInfo.Utc));
        }
        finally { CultureInfo.CurrentCulture = old; }
    }

    [Fact]
    public void Forecast_day_name_comes_from_the_calendar_date_and_bad_days_give_null()
    {
        Assert.Equal("FRI", Copy.ForecastDayName("2026-01-02"));
        Assert.Null(Copy.ForecastDayName(""));
        Assert.Null(Copy.ForecastDayName("x"));
        Assert.Null(Copy.ForecastDayName(null));
    }

    [Fact]
    public void Forecast_tooltip_drops_null_clauses()
    {
        Assert.Equal("Friday: high 24°, low 15°, rain 60%", Copy.ForecastTooltip(new("2026-01-02", "rain", 24, 15, 60)));
        Assert.Equal("Friday: low 15°, rain 60%", Copy.ForecastTooltip(new("2026-01-02", "rain", null, 15, 60)));
        Assert.Equal("Friday", Copy.ForecastTooltip(new("2026-01-02", null, null, null, null)));
        Assert.Null(Copy.ForecastTooltip(new("x", "rain", 1, 1, 1)));
    }

    [Fact]
    public void Header_tips_and_the_new_strings_have_no_apostrophe_or_quote()
    {
        Assert.Equal("Hide the weather", Copy.TodayHeaderTip(false, false));
        Assert.Equal("Show the weather", Copy.TodayHeaderTip(true, false));
        Assert.Equal("Hidden to fit the screen. Close another section to make room.", Copy.TodayHeaderTip(false, true));
        Assert.Equal(Copy.SectionFolded, Copy.TodayHeaderTip(true, true));
        foreach (var s in new[] { Copy.SectionFolded, Copy.TodayHeaderTip(false, false), Copy.TodayHeaderTip(true, false), Copy.TodayName(At, TimeZoneInfo.Utc), Copy.ForecastTooltip(new("2026-01-02", "rain", 24, 15, 60))! })
            Assert.DoesNotContain('\'', s);
    }

    [Fact]
    public void Usable_forecast_skips_bad_days_cuts_to_four_and_treats_null_as_empty()
    {
        ForecastDay D(string? day) => new(day, "clear", 1, 1, 1);
        Assert.Empty(ForecastDay.Usable(null));
        Assert.Empty(ForecastDay.Usable([D(""), D("x"), D(null)]));
        var six = new[] { D("2026-01-02"), D(""), D("2026-01-03"), D("2026-01-04"), D("2026-01-05"), D("2026-01-06"), D("2026-01-07") };
        Assert.Equal(["2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"], ForecastDay.Usable(six).Select(d => d.Day));
    }
}
