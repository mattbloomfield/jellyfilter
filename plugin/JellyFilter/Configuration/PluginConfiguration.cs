using MediaBrowser.Model.Plugins;

namespace JellyFilter.Configuration;

public class PluginConfiguration : BasePluginConfiguration
{
    public string EdlDirectory { get; set; } = "/mnt/nfs-media/jellyfilter/edl";
}
