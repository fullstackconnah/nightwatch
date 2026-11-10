using NightwatchDesk.Core;

namespace Core.Tests;

public class ConfigTests : IDisposable
{
    readonly string dir = Directory.CreateTempSubdirectory("nwdesk").FullName;
    public void Dispose() => Directory.Delete(dir, true);
    string Write(string text) { var p = Path.Combine(dir, "desk.json"); File.WriteAllText(p, text); return p; }
    const string FakeToken = "tok_AbCdEf0123456789AbCdEf0123456789";

    [Fact]
    public void Valid_file_is_Ok_with_trailing_slashes_trimmed()
    {
        var r = DeskConfig.Load(Write($"{{\"baseUrl\":\" http://homelab.local:3005// \",\"token\":\"{FakeToken}\"}}"));
        Assert.Equal(new ConfigResult.Ok("http://homelab.local:3005", FakeToken), r);
    }

    [Fact]
    public void Missing_file_is_Missing() => Assert.IsType<ConfigResult.Missing>(DeskConfig.Load(Path.Combine(dir, "nope.json")));

    [Fact]
    public void Invalid_json_reports_a_one_based_line()
    {
        // The bad value is on the second line; JsonException.LineNumber is zero-based (1), so we report 2.
        var r = Assert.IsType<ConfigResult.Unreadable>(DeskConfig.Load(Write("{\n\"baseUrl\": ,\n\"token\": \"x\"}")));
        Assert.Equal(2, r.Line);
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("\"text\"")]
    public void Valid_json_of_the_wrong_shape_is_Unreadable(string text)
        => Assert.IsType<ConfigResult.Unreadable>(DeskConfig.Load(Write(text)));

    [Theory]
    [InlineData("{\"baseUrl\":\"http://h:1\"}")]
    [InlineData("{\"baseUrl\":\"http://h:1\",\"token\":\"\"}")]
    [InlineData("{\"baseUrl\":\"http://h:1\",\"token\":\"   \"}")]
    [InlineData("{\"baseUrl\":\"http://h:1\",\"token\":\"REPLACE_ME\"}")]
    [InlineData("{\"baseUrl\":\"http://h:1\",\"token\":5}")]
    public void Blank_missing_or_placeholder_token_is_TokenMissing(string text)
        => Assert.IsType<ConfigResult.TokenMissing>(DeskConfig.Load(Write(text)));

    [Theory]
    [InlineData("{\"token\":\"" + FakeToken + "\"}")]
    [InlineData("{\"baseUrl\":\"\",\"token\":\"" + FakeToken + "\"}")]
    [InlineData("{\"baseUrl\":\"homelab.local:3005\",\"token\":\"" + FakeToken + "\"}")]
    [InlineData("{\"baseUrl\":\"ftp://homelab.local\",\"token\":\"" + FakeToken + "\"}")]
    [InlineData("{\"baseUrl\":\"/relative\",\"token\":\"" + FakeToken + "\"}")]
    public void Bad_address_is_BadAddress(string text)
        => Assert.IsType<ConfigResult.BadAddress>(DeskConfig.Load(Write(text)));

    [Fact]
    public void No_result_ever_prints_the_token()
    {
        var results = new ConfigResult[]
        {
            DeskConfig.Load(Write($"{{\"baseUrl\":\"http://h:1\",\"token\":\"{FakeToken}\"}}")),
            DeskConfig.Load(Write($"{{\"baseUrl\":\"nope\",\"token\":\"{FakeToken}\"}}")),
            DeskConfig.Load(Write($"{{\"baseUrl\":,\"token\":\"{FakeToken}\"}}")),
        };
        foreach (var r in results) Assert.DoesNotContain(FakeToken, r.ToString());
        Assert.DoesNotContain(FakeToken, Copy.Note(new View.Config(results[1])) ?? "");
    }
}
