using System.Text.Json.Serialization;

namespace JellyFilter.Edl;

public class EdlDocument
{
    [JsonPropertyName("version")]
    public int Version { get; set; }

    [JsonPropertyName("media_id")]
    public string MediaId { get; set; } = string.Empty;

    [JsonPropertyName("media_path")]
    public string MediaPath { get; set; } = string.Empty;

    [JsonPropertyName("duration_seconds")]
    public double DurationSeconds { get; set; }

    [JsonPropertyName("generated_at")]
    public string GeneratedAt { get; set; } = string.Empty;

    [JsonPropertyName("entries")]
    public List<EdlEntry> Entries { get; set; } = [];
}

public class EdlEntry
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("start")]
    public double Start { get; set; }

    [JsonPropertyName("end")]
    public double End { get; set; }

    [JsonPropertyName("type")]
    public string Type { get; set; } = "mute"; // "mute" | "skip"

    [JsonPropertyName("category")]
    public string Category { get; set; } = string.Empty;

    [JsonPropertyName("word")]
    public string? Word { get; set; }

    [JsonPropertyName("confidence")]
    public double Confidence { get; set; }

    [JsonPropertyName("source")]
    public string Source { get; set; } = string.Empty;

    [JsonPropertyName("confirmed")]
    public bool Confirmed { get; set; }
}
