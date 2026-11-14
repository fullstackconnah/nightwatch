using NightwatchDesk.Core;

namespace Core.Tests;

public class VitalsHistoryTests
{
    static readonly DateTimeOffset T0 = new(2026, 1, 1, 14, 0, 0, TimeSpan.Zero);
    static readonly TimeSpan Poll = TimeSpan.FromSeconds(30);
    static VitalsHistory New() => new(Poll);
    static Vitals V(double cpu, double mem = 0) => new(cpu, mem, null);

    [Fact]
    public void Caps_at_24_oldest_first()
    {
        var h = New();
        for (var i = 1; i <= 30; i++) h.Add(T0.AddSeconds(30 * i), V(i, 100 - i));
        Assert.Equal(24, h.Samples.Length);
        Assert.Equal(7, h.Samples[0].Cpu);
        Assert.Equal(30, h.Samples[^1].Cpu);
        Assert.Equal(70, h.Samples[^1].Mem);
        Assert.Equal(T0.AddSeconds(30 * 7), h.Samples[0].At);
    }

    [Fact]
    public void Null_vitals_adds_nothing_and_keeps_the_same_array()
    {
        var h = New();
        h.Add(T0, V(10));
        var before = h.Samples;
        h.Add(T0.AddSeconds(30), null);
        Assert.Same(before, h.Samples);
        Assert.Single(h.Samples);
    }

    [Fact]
    public void The_same_or_an_older_glance_adds_nothing()
    {
        var h = New();
        h.Add(T0, V(10));
        var before = h.Samples;
        h.Add(T0, V(99));
        h.Add(T0.AddSeconds(-30), V(99));
        Assert.Same(before, h.Samples);
        Assert.Single(h.Samples);
        Assert.Equal(10, h.Samples[0].Cpu);
    }

    [Fact]
    public void A_new_sample_is_a_new_array()
    {
        var h = New();
        h.Add(T0, V(10));
        var first = h.Samples;
        h.Add(T0.AddSeconds(30), V(20));
        Assert.NotSame(first, h.Samples);
        Assert.Single(first); // the array a view holds is never edited in place
    }

    [Fact]
    public void A_gap_of_three_polls_keeps_the_samples_and_five_clears_them()
    {
        var h = New();
        h.Add(T0, V(1));
        h.Add(T0.AddSeconds(30), V(2));
        h.Add(T0.AddSeconds(30 + 3 * 30), V(3)); // one or two missed polls: the line stays
        Assert.Equal(3, h.Samples.Length);
        h.Add(T0.AddSeconds(120 + 5 * 30), V(4)); // a sleep or a long offline spell: only the new sample is left
        Assert.Single(h.Samples);
        Assert.Equal(4, h.Samples[0].Cpu);
    }

    [Fact]
    public void The_gap_limit_is_four_and_a_half_poll_intervals()
    {
        var h = New();
        h.Add(T0, V(1));
        h.Add(T0 + Poll * 4.5, V(2)); // exactly 135 s: kept
        Assert.Equal(2, h.Samples.Length);
        h.Add(T0 + Poll * 4.5 + Poll * 4.5 + TimeSpan.FromSeconds(1), V(3)); // 1 s over: cleared
        Assert.Single(h.Samples);
        var other = new VitalsHistory(TimeSpan.FromSeconds(10)); // derived from the interval it is given
        other.Add(T0, V(1));
        other.Add(T0.AddSeconds(46), V(2));
        Assert.Single(other.Samples);
    }

    [Fact]
    public void Samples_reference_is_stable_without_an_add()
    {
        var h = New();
        Assert.Same(h.Samples, h.Samples);
        h.Add(T0, V(1));
        Assert.Same(h.Samples, h.Samples);
    }
}
