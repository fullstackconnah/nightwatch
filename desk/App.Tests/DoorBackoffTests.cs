using NightwatchDesk.Core;

namespace NightwatchDesk.App.Tests;

/// <summary>DESK-N10: one failed door poll plus the back-off must stay under the wake gap, or the next poll only baselines and drops a ring.</summary>
public class DoorBackoffTests
{
    [Fact]
    public void One_failed_poll_plus_backoff_stays_under_the_wake_gap() =>
        Assert.True(DeskHost.DoorEvery + DeskHost.DoorBackoff < DoorRing.Gap);
}
