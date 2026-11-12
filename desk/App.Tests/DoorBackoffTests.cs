using NightwatchDesk.Core;

namespace NightwatchDesk.App.Tests;

/// <summary>DESK-N10: between two successful door stamps lie the wait, a timed-out poll, the back-off, then the next success's own latency; all must stay under the wake gap, or the next poll only baselines and drops a ring.</summary>
public class DoorBackoffTests
{
    [Fact]
    public void Wait_timeout_backoff_and_next_answer_stay_under_the_wake_gap() =>
        Assert.True(DeskHost.DoorEvery + Poller.DoorTimeout + DeskHost.DoorBackoff + Poller.DoorTimeout < DoorRing.Gap);
}
