using JellyFilter.Preferences;
using MediaBrowser.Controller.Devices;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Dlna;
using MediaBrowser.Model.Session;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace JellyFilter.Transcode;

/// <summary>
/// Forces transcoding for users with filtering enabled by stripping DirectPlayProfiles
/// from their device capabilities. When DirectPlayProfiles is empty, Jellyfin's
/// StreamBuilder cannot select direct play and falls through to transcoding —
/// at which point the ffmpeg wrapper injects the -af mute filter.
/// </summary>
public class FilterTranscodeHook : IHostedService
{
    private readonly ILogger<FilterTranscodeHook> _logger;
    private readonly ISessionManager _sessionManager;
    private readonly IDeviceManager _deviceManager;
    private readonly PreferencesStore _prefsStore;

    public FilterTranscodeHook(
        ILogger<FilterTranscodeHook> logger,
        ISessionManager sessionManager,
        IDeviceManager deviceManager,
        PreferencesStore prefsStore)
    {
        _logger = logger;
        _sessionManager = sessionManager;
        _deviceManager = deviceManager;
        _prefsStore = prefsStore;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _sessionManager.PlaybackStart += OnPlaybackStart;
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _sessionManager.PlaybackStart -= OnPlaybackStart;
        return Task.CompletedTask;
    }

    private void OnPlaybackStart(object? sender, PlaybackProgressEventArgs e)
    {
        var userId = e.Session?.UserId;
        if (userId is null) return;

        var prefs = _prefsStore.GetOrCreate(userId.Value.ToString());
        var deviceId = e.Session?.DeviceId;
        if (deviceId is null) return;

        try
        {
            if (prefs.Enabled)
                ForceTranscode(deviceId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to apply transcode override for device {DeviceId}", deviceId);
        }
    }

    private void ForceTranscode(string deviceId)
    {
        // Overwrite the stored ClientCapabilities for this device with a profile
        // that has no DirectPlayProfiles — Jellyfin's StreamBuilder will then
        // always select a TranscodingProfile, routing audio through ffmpeg.
        // Empty DirectPlayProfiles forces Jellyfin's StreamBuilder to skip
        // direct play and select a TranscodingProfile instead. Jellyfin's
        // own default profiles take over from there.
        var caps = new ClientCapabilities
        {
            DeviceProfile = new DeviceProfile
            {
                DirectPlayProfiles = [],
            },
        };
        _deviceManager.SaveCapabilities(deviceId, caps);
        _logger.LogDebug("Forced transcoding for device {DeviceId}", deviceId);
    }
}
