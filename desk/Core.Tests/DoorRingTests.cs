using NightwatchDesk.Core;

namespace Core.Tests;

public class DoorRingTests
{
    const string Base = "http://h.local:3005";
    static TimeSpan T(double s) => TimeSpan.FromSeconds(s);
    static DoorSnapshot Ring(string at, double age = 3, string kind = "ding") => new(true, kind, at, age);
    static (DoorState, Toast?) Step(DoorState s, DoorSnapshot d, double at) => DoorRing.Next(s, d, T(at), Base);

    // A started state: baseline recorded at t=0 against firedAt "A".
    static DoorState Started() => Step(new DoorState(), Ring("A", 900), 0).Item1;

    [Fact]
    public void A_new_fresh_ding_toasts_with_a_door_click()
    {
        var (s, t) = Step(Started(), Ring("B"), 5);
        Assert.Equal(new Toast("Front door", "Someone rang the doorbell.", new Click.OpenUrl(Base + "/kiosk?door=1")), t);
        Assert.Equal("B", s.FiredAt);
    }

    [Fact]
    public void The_same_firedAt_does_not_toast_again() => Assert.Null(Step(Step(Started(), Ring("B"), 5).Item1, Ring("B", 8), 10).Item2);

    [Fact]
    public void An_age_of_46_does_not_toast_but_45_does()
    {
        Assert.Null(Step(Started(), Ring("B", 46), 5).Item2);
        Assert.NotNull(Step(Started(), Ring("B", 45), 5).Item2);
    }

    [Fact]
    public void The_first_poll_only_records_a_baseline()
    {
        var (s, t) = Step(new DoorState(), Ring("A", 2), 0);
        Assert.Null(t);
        Assert.Equal("A", s.FiredAt);
    }

    [Fact]
    public void A_poll_after_a_gap_over_30_s_only_records_a_baseline()
    {
        Assert.Null(Step(Started(), Ring("B", 2), 31).Item2);
        Assert.NotNull(Step(Started(), Ring("B", 2), 30).Item2);
    }

    [Fact]
    public void Two_rings_10_s_apart_give_one_toast()
    {
        var (s, t1) = Step(Started(), Ring("B"), 5);
        var (_, t2) = Step(s, Ring("C"), 15);
        Assert.NotNull(t1);
        Assert.Null(t2);
    }

    [Fact]
    public void A_ring_after_30_s_toasts_again()
    {
        var (s, _) = Step(Started(), Ring("B"), 5);
        s = Step(s, Ring("B", 20), 20).Item1;
        Assert.NotNull(Step(s, Ring("C"), 35).Item2);
    }

    [Fact]
    public void No_latest_and_a_status_that_is_not_ok_stay_quiet()
    {
        Assert.Null(Step(Started(), new DoorSnapshot(true, null, null, null), 5).Item2);
        Assert.Null(Step(Started(), new DoorSnapshot(false, "ding", "B", 1), 5).Item2);
    }

    [Theory]
    [InlineData("ding", "Someone rang the doorbell.")]
    [InlineData("person", "Someone is at the front door.")]
    [InlineData("motion", "Movement at the front door.")]
    [InlineData("activity", "Movement at the front door.")]
    [InlineData("anything-new", "Movement at the front door.")]
    [InlineData(null, "Movement at the front door.")]
    public void Copy_by_kind(string? kind, string text) => Assert.Equal(text, Copy.DoorToast(kind, Base).Text);

    [Fact]
    public void Parser_reads_the_snapshot_and_rejects_junk()
    {
        Assert.Equal(new DoorSnapshot(true, "ding", "2026-01-01T00:00:00Z", 4.5),
            DoorParser.Parse("{\"status\":\"ok\",\"cameras\":[],\"latest\":{\"kind\":\"ding\",\"name\":\"x\",\"firedAt\":\"2026-01-01T00:00:00Z\",\"ageSec\":4.5}}"));
        Assert.Equal(new DoorSnapshot(true, null, null, null), DoorParser.Parse("{\"status\":\"ok\",\"latest\":null}"));
        Assert.False(DoorParser.Parse("{\"status\":\"unreachable\",\"latest\":null}")!.Ok);
        Assert.Null(DoorParser.Parse("nope"));
        Assert.Null(DoorParser.Parse("[1]"));
    }
}
