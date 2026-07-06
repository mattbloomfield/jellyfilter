using System.Net.Mime;
using JellyFilter.Edl;
using JellyFilter.Preferences;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace JellyFilter.Api;

[ApiController]
[Authorize(Policy = "DefaultAuthorization")]
[Produces(MediaTypeNames.Application.Json)]
public class JellyFilterController : ControllerBase
{
    private readonly ILogger<JellyFilterController> _logger;
    private readonly PreferencesStore _prefs;
    private readonly EdlLoader _edl;
    private readonly IAuthorizationContext _authContext;

    public JellyFilterController(
        ILogger<JellyFilterController> logger,
        PreferencesStore prefs,
        EdlLoader edl,
        IAuthorizationContext authContext)
    {
        _logger = logger;
        _prefs = prefs;
        _edl = edl;
        _authContext = authContext;
    }

    [HttpGet("/jellyfilter/preferences")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult<UserFilterPreferences>> GetPreferences()
    {
        var auth = await _authContext.GetAuthorizationInfo(Request).ConfigureAwait(false);
        return Ok(_prefs.GetOrCreate(auth.UserId.ToString()));
    }

    [HttpPut("/jellyfilter/preferences")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult<UserFilterPreferences>> UpdatePreferences([FromBody] UserFilterPreferences body)
    {
        var auth = await _authContext.GetAuthorizationInfo(Request).ConfigureAwait(false);
        body.UserId = auth.UserId.ToString();
        _prefs.Upsert(body);
        return Ok(body);
    }

    [HttpGet("/jellyfilter/edl/{itemId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult<EdlDocument> GetEdl(string itemId)
    {
        var doc = _edl.Load(itemId);
        if (doc is null) return NotFound();
        return Ok(doc);
    }

    [HttpPut("/jellyfilter/edl/{itemId}/entry/{entryId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult<EdlEntry> UpdateEntry(string itemId, string entryId, [FromBody] EdlEntry body)
    {
        var doc = _edl.Load(itemId);
        if (doc is null) return NotFound();
        var idx = doc.Entries.FindIndex(e => e.Id == entryId);
        if (idx < 0) return NotFound();
        body.Id = entryId;
        doc.Entries[idx] = body;
        _edl.Save(itemId, doc);
        return Ok(body);
    }

    [HttpDelete("/jellyfilter/edl/{itemId}/entry/{entryId}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult DeleteEntry(string itemId, string entryId)
    {
        if (!_edl.DeleteEntry(itemId, entryId)) return NotFound();
        return NoContent();
    }

    // Queue and status are served by the whisper pipeline API (port 8765).
    // These stubs let the plugin report that cleanly if the UI hits Jellyfin directly.
    [HttpGet("/jellyfilter/queue")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult<IEnumerable<object>> GetQueue()
        => Ok(Array.Empty<object>());

    [HttpGet("/jellyfilter/status/{itemId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult<object> GetStatus(string itemId)
    {
        var hasEdl = _edl.HasEdl(itemId);
        return Ok(new { status = hasEdl ? "done" : "no-data", hit_count = (int?)null });
    }
}
