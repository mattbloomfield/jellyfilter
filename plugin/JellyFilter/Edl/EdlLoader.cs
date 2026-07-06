using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace JellyFilter.Edl;

public class EdlLoader
{
    private readonly ILogger<EdlLoader> _logger;
    private readonly string _edlDir;

    // Cache recently loaded EDL docs to avoid re-reading on every transcode decision
    private readonly Dictionary<string, (EdlDocument Doc, DateTime LoadedAt)> _cache = new();
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(5);

    public EdlLoader(ILogger<EdlLoader> logger, string edlDir)
    {
        _logger = logger;
        _edlDir = edlDir;
    }

    public EdlDocument? Load(string itemId)
    {
        if (_cache.TryGetValue(itemId, out var cached) && DateTime.UtcNow - cached.LoadedAt < CacheTtl)
            return cached.Doc;

        var path = Path.Combine(_edlDir, $"{itemId}.jellyfilter.json");
        if (!File.Exists(path))
            return null;

        try
        {
            var json = File.ReadAllText(path);
            var doc = JsonSerializer.Deserialize<EdlDocument>(json);
            if (doc is not null)
            {
                _cache[itemId] = (doc, DateTime.UtcNow);
                _logger.LogDebug("Loaded EDL for {ItemId}: {Count} entries", itemId, doc.Entries.Count);
            }
            return doc;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load EDL for {ItemId}", itemId);
            return null;
        }
    }

    public void Invalidate(string itemId) => _cache.Remove(itemId);

    public bool HasEdl(string itemId)
        => File.Exists(Path.Combine(_edlDir, $"{itemId}.jellyfilter.json"));

    public EdlDocument? Save(string itemId, EdlDocument doc)
    {
        var path = Path.Combine(_edlDir, $"{itemId}.jellyfilter.json");
        try
        {
            var json = JsonSerializer.Serialize(doc, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(path, json);
            Invalidate(itemId);
            return doc;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save EDL for {ItemId}", itemId);
            return null;
        }
    }

    public bool DeleteEntry(string itemId, string entryId)
    {
        var doc = Load(itemId);
        if (doc is null) return false;
        var before = doc.Entries.Count;
        doc.Entries.RemoveAll(e => e.Id == entryId);
        if (doc.Entries.Count == before) return false;
        Save(itemId, doc);
        return true;
    }
}
