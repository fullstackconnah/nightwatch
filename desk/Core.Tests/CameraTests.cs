using System.Net;
using NightwatchDesk.Core;

namespace Core.Tests;

public class CameraTests
{
    static readonly DateTimeOffset T0 = new(2026, 1, 1, 4, 0, 0, TimeSpan.Zero);

    // --- frame fetch mapper ---------------------------------------------------------------
    [Theory]
    [InlineData(200, "image/jpeg", 1000L, true)]
    [InlineData(200, "image/png", null, true)]
    [InlineData(200, "IMAGE/JPEG; charset=binary", 1572864L, true)]
    [InlineData(200, "image/jpeg", 1572865L, false)]
    [InlineData(200, "text/html", 10L, false)]
    [InlineData(200, "image/gif", 10L, false)]
    [InlineData(200, null, 10L, false)]
    [InlineData(401, "image/jpeg", 10L, false)]
    [InlineData(404, null, null, false)]
    [InlineData(502, null, 0L, false)]
    [InlineData(503, "image/jpeg", 10L, false)]
    [InlineData(500, "image/jpeg", 10L, false)]
    public void Map_accepts_only_a_small_jpeg_or_png_200(int status, string? type, long? length, bool ok)
        => Assert.Equal(ok, CameraFrame.Map(status, type, length) is FrameOutcome.Image);

    sealed class Stub(Func<HttpResponseMessage> make) : HttpMessageHandler
    {
        public HttpRequestMessage? Seen;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct) { Seen = r; return Task.FromResult(make()); }
    }

    sealed class Boom : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct) => throw new HttpRequestException("connection refused");
    }

    static HttpResponseMessage Resp(HttpStatusCode s, byte[] body, string type = "image/jpeg")
    {
        var m = new HttpResponseMessage(s) { Content = new StreamContent(new MemoryStream(body)) };
        m.Content.Headers.ContentType = new(type);
        return m;
    }

    static Task<FrameOutcome> Fetch(HttpMessageHandler h) => CameraFrame.FetchAsync(new HttpClient(h), "http://h:1", "tok");

    [Fact]
    public async Task Fetch_returns_the_bytes_of_a_good_frame_and_sends_the_bearer_token()
    {
        var stub = new Stub(() => Resp(HttpStatusCode.OK, [1, 2, 3]));
        var r = await Fetch(stub);
        Assert.Equal(new byte[] { 1, 2, 3 }, Assert.IsType<FrameOutcome.Frame>(r).Bytes);
        Assert.Equal("http://h:1/api/desk/camera", stub.Seen!.RequestUri!.ToString());
        Assert.Equal("Bearer tok", stub.Seen.Headers.Authorization!.ToString());
    }

    [Fact]
    public async Task Fetch_over_the_cap_is_a_Failure_even_when_the_length_is_unknown()
        => Assert.IsType<FrameOutcome.Failure>(await Fetch(new Stub(() => Resp(HttpStatusCode.OK, new byte[CameraFrame.MaxBytes + 1]))));

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.BadGateway)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    public async Task Fetch_of_an_error_status_is_a_Failure(HttpStatusCode s)
        => Assert.IsType<FrameOutcome.Failure>(await Fetch(new Stub(() => Resp(s, []))));

    [Fact]
    public async Task Fetch_of_a_network_error_is_a_Failure_never_an_exception()
        => Assert.IsType<FrameOutcome.Failure>(await Fetch(new Boom()));

    [Fact]
    public async Task Fetch_of_a_non_image_is_a_Failure()
        => Assert.IsType<FrameOutcome.Failure>(await Fetch(new Stub(() => Resp(HttpStatusCode.OK, [1], "text/html"))));

    // --- frame state ----------------------------------------------------------------------
    [Theory]
    [InlineData(5, 10, 300)] // Live to 2I; NoPicture at max(300, 3I)
    [InlineData(30, 60, 300)]
    [InlineData(150, 300, 450)]
    [InlineData(300, 600, 900)]
    public void Frame_state_boundaries(int i, int live, int none)
    {
        FrameState At(double sec) => FrameClock.Compute(T0.AddSeconds(sec), T0, i, false, false);
        Assert.Equal(FrameState.Live, At(0));
        Assert.Equal(FrameState.Live, At(live));
        Assert.Equal(FrameState.Stale, At(live + 0.001));
        Assert.Equal(FrameState.Stale, At(none - 0.001));
        Assert.Equal(FrameState.NoPicture, At(none));
        Assert.Equal(FrameState.NoPicture, At(none + 5000));
    }

    // Watch live (SHAPE "Camera live view"): fresh to 5 s, Stale to 60 s, then No picture, whatever the still's interval is.
    [Theory]
    [InlineData(5)]
    [InlineData(30)]
    [InlineData(300)]
    public void Live_view_state_boundaries_are_5_and_60_seconds_and_ignore_the_interval(int i)
    {
        FrameState At(double sec) => FrameClock.ComputeLive(T0.AddSeconds(sec), T0, false);
        Assert.Equal(FrameState.Live, At(0));
        Assert.Equal(FrameState.Live, At(5));
        Assert.Equal(FrameState.Stale, At(5.001));
        Assert.Equal(FrameState.Stale, At(59.999));
        Assert.Equal(FrameState.NoPicture, At(60));
        Assert.Equal(FrameState.NoPicture, At(61));
        // the still's own formula is unchanged for the same interval
        Assert.Equal(FrameState.Live, FrameClock.Compute(T0.AddSeconds(2.0 * i), T0, i, false, false));
        Assert.Equal(FrameState.Stale, FrameClock.Compute(T0.AddSeconds(2.0 * i + 0.001), T0, i, false, false));
        Assert.Equal(FrameState.NoPicture, FrameClock.Compute(T0.AddSeconds(Math.Max(300, 3.0 * i)), T0, i, false, false));
    }

    [Fact]
    public void Live_view_with_no_frame_is_Loading_until_a_fetch_fails()
    {
        Assert.Equal(FrameState.Loading, FrameClock.ComputeLive(T0, null, false));
        Assert.Equal(FrameState.NoPicture, FrameClock.ComputeLive(T0, null, true));
    }

    [Fact]
    public void Frame_state_with_no_frame_is_Loading_until_a_fetch_fails()
    {
        Assert.Equal(FrameState.Loading, FrameClock.Compute(T0, null, 30, true, false));
        Assert.Equal(FrameState.Loading, FrameClock.Compute(T0, null, 30, false, false));
        Assert.Equal(FrameState.NoPicture, FrameClock.Compute(T0, null, 30, false, true));
    }

    [Theory]
    [InlineData(5, 299.9, false)]
    [InlineData(5, 300, true)]
    [InlineData(30, 300, true)]
    [InlineData(150, 449, false)]
    [InlineData(150, 450, true)]
    [InlineData(300, 899, false)]
    [InlineData(300, 900, true)]
    public void Resume_drops_a_kept_frame_at_or_past_the_NoPicture_threshold(int i, double age, bool drop)
        => Assert.Equal(drop, FrameClock.DropOnResume(T0.AddSeconds(age), T0, i));

    // --- camera visibility ----------------------------------------------------------------
    static Outcome Ok(bool camera) => new Outcome.Ok(GlanceTests.Golden() with { Camera = camera });

    [Fact]
    public void Camera_stays_hidden_until_the_first_true()
    {
        var v = new CameraVisibility();
        for (var n = 0; n < 5; n++) { v.OnPoll(Ok(false)); Assert.False(v.Visible); }
        v.OnPoll(Ok(true));
        Assert.True(v.Visible);
    }

    [Fact]
    public void Camera_hides_on_the_third_false_in_a_row_and_a_true_resets_the_count()
    {
        var v = new CameraVisibility();
        v.OnPoll(Ok(true));
        v.OnPoll(Ok(false)); v.OnPoll(Ok(false));
        Assert.True(v.Visible);
        v.OnPoll(Ok(true));
        v.OnPoll(Ok(false)); v.OnPoll(Ok(false));
        Assert.True(v.Visible);
        v.OnPoll(Ok(false));
        Assert.False(v.Visible);
        v.OnPoll(Ok(false));
        Assert.False(v.Visible);
        v.OnPoll(Ok(true));
        Assert.True(v.Visible);
    }

    [Fact]
    public void Failed_polls_count_nothing()
    {
        var v = new CameraVisibility();
        v.OnPoll(Ok(true));
        v.OnPoll(Ok(false)); v.OnPoll(Ok(false));
        for (var n = 0; n < 5; n++) v.OnPoll(new Outcome.Failed());
        Assert.True(v.Visible);
        v.OnPoll(Ok(false));
        Assert.False(v.Visible);
    }

    [Fact]
    public void Client_error_hides_at_once_and_a_later_true_shows_again()
    {
        foreach (Outcome err in new Outcome[] { new Outcome.Unauthorized(), new Outcome.Off(), new Outcome.TooNew(2) })
        {
            var v = new CameraVisibility();
            v.OnPoll(Ok(true));
            v.OnPoll(err);
            Assert.False(v.Visible);
            v.OnPoll(Ok(true));
            Assert.True(v.Visible);
        }
    }

    // --- weather visibility ---------------------------------------------------------------
    static Outcome OkW(bool weather) => new Outcome.Ok(GlanceTests.Golden() with { Weather = weather ? new WeatherNow(22, 19, "Partly cloudy", 24, 15, 30, "partly-cloudy") : null });

    [Fact]
    public void Weather_stays_hidden_until_the_first_value_and_dims_for_one_or_two_nulls()
    {
        var v = new WeatherVisibility();
        for (var n = 0; n < 5; n++) { v.OnPoll(OkW(false)); Assert.False(v.Visible); }
        v.OnPoll(OkW(true));
        Assert.True(v.Visible); Assert.False(v.Dim);
        v.OnPoll(OkW(false));
        Assert.True(v.Visible); Assert.True(v.Dim);
        v.OnPoll(OkW(false));
        Assert.True(v.Visible); Assert.True(v.Dim);
        v.OnPoll(OkW(true));
        Assert.False(v.Dim);
    }

    [Fact]
    public void Weather_hides_on_the_third_null_in_a_row_and_a_value_resets_the_count()
    {
        var v = new WeatherVisibility();
        v.OnPoll(OkW(true));
        v.OnPoll(OkW(false)); v.OnPoll(OkW(true));
        v.OnPoll(OkW(false)); v.OnPoll(OkW(false));
        Assert.True(v.Visible);
        v.OnPoll(OkW(false));
        Assert.False(v.Visible); Assert.False(v.Dim);
    }

    [Fact]
    public void Weather_failed_polls_count_nothing_and_a_client_error_hides_at_once()
    {
        var v = new WeatherVisibility();
        v.OnPoll(OkW(true));
        v.OnPoll(OkW(false)); v.OnPoll(OkW(false));
        for (var n = 0; n < 5; n++) v.OnPoll(new Outcome.Failed());
        Assert.True(v.Visible);
        foreach (Outcome err in new Outcome[] { new Outcome.Unauthorized(), new Outcome.Off(), new Outcome.TooNew(2) })
        {
            v.OnPoll(OkW(true));
            v.OnPoll(err);
            Assert.False(v.Visible);
        }
    }

    // --- poll gate ------------------------------------------------------------------------
    [Fact]
    public void Fetch_is_allowed_only_when_nothing_pauses_it()
    {
        Assert.True(FrameGate.ShouldFetch(false, false, false, false, false));
        Assert.False(FrameGate.ShouldFetch(true, false, false, false, false)); // window hidden or minimised
        Assert.False(FrameGate.ShouldFetch(false, true, false, false, false)); // block collapsed, folded or hidden
        Assert.False(FrameGate.ShouldFetch(false, false, true, false, false)); // client-error view
        Assert.False(FrameGate.ShouldFetch(false, false, false, true, false)); // session locked
        Assert.False(FrameGate.ShouldFetch(false, false, false, false, true)); // suspended
    }
}
