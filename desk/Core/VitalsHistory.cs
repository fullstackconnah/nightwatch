namespace NightwatchDesk.Core;

/// <summary>One successful glance's CPU and memory, as percentages.</summary>
public sealed record VitalsSample(DateTimeOffset At, double Cpu, double Mem);

/// <summary>The VITALS sparks' history: at most Cap samples, in memory only. The host adds one per successful glance (never from a clock tick, a fold or a stale view).
/// Samples is a new array on every add and the same instance otherwise, so a view redraws only when the instance changes. A gap of more than 4.5 poll intervals
/// (one or two missed polls keep the line; a sleep or a long offline spell does not) or a sample older than the last (the clock stepped back) clears the history first; the same time twice is dropped.</summary>
public sealed class VitalsHistory(TimeSpan pollEvery)
{
    public const int Cap = 24;
    readonly TimeSpan maxGap = pollEvery * 4.5;

    public VitalsSample[] Samples { get; private set; } = [];

    public void Add(DateTimeOffset at, Vitals? v)
    {
        if (v is null) return;
        if (Samples.Length > 0)
        {
            var gap = at - Samples[^1].At;
            if (gap == TimeSpan.Zero) return; // the same glance twice
            if (gap < TimeSpan.Zero || gap > maxGap) Samples = []; // a backwards clock step restarts the line like a long gap
        }
        Samples = [.. Samples.TakeLast(Cap - 1), new VitalsSample(at, v.Cpu, v.Mem)];
    }
}
