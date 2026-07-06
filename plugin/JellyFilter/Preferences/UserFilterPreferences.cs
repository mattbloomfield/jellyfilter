using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace JellyFilter.Preferences;

public class FilterCategory
{
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = true;
}

public class UserFilterPreferences
{
    [JsonPropertyName("userId")]
    public string UserId { get; set; } = string.Empty;

    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = false;

    [JsonPropertyName("filters")]
    public Dictionary<string, FilterCategory> Filters { get; set; } = new()
    {
        ["profanity"] = new FilterCategory { Enabled = true },
        ["violence"] = new FilterCategory { Enabled = false },
        ["sexual-content"] = new FilterCategory { Enabled = false },
        ["substance-use"] = new FilterCategory { Enabled = false },
    };
}

public class PreferencesStore
{
    private readonly ILogger<PreferencesStore> _logger;
    private readonly string _storePath;
    private Dictionary<string, UserFilterPreferences> _cache = new();

    public PreferencesStore(ILogger<PreferencesStore> logger, string dataDir)
    {
        _logger = logger;
        _storePath = Path.Combine(dataDir, "jellyfilter-prefs.json");
        Load();
    }

    private void Load()
    {
        if (!File.Exists(_storePath)) return;
        try
        {
            var json = File.ReadAllText(_storePath);
            _cache = JsonSerializer.Deserialize<Dictionary<string, UserFilterPreferences>>(json) ?? new();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load preferences from {Path}", _storePath);
        }
    }

    private void Save()
    {
        try
        {
            var json = JsonSerializer.Serialize(_cache, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(_storePath, json);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save preferences to {Path}", _storePath);
        }
    }

    public UserFilterPreferences GetOrCreate(string userId)
    {
        if (_cache.TryGetValue(userId, out var prefs)) return prefs;
        prefs = new UserFilterPreferences { UserId = userId };
        _cache[userId] = prefs;
        return prefs;
    }

    public void Upsert(UserFilterPreferences prefs)
    {
        _cache[prefs.UserId] = prefs;
        Save();
    }
}
