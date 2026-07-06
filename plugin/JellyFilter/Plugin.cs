using JellyFilter.Configuration;
using JellyFilter.Edl;
using JellyFilter.Preferences;
using JellyFilter.Transcode;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Devices;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace JellyFilter;

public class Plugin : BasePlugin<PluginConfiguration>
{
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    public override string Name => "JellyFilter";
    public override Guid Id => Guid.Parse("7f3a1c2e-4b5d-4e8f-9a0b-1c2d3e4f5a6b");
    public static Plugin? Instance { get; private set; }
}

public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection services, IServerApplicationHost applicationHost)
    {
        services.AddSingleton<PreferencesStore>(sp =>
        {
            var logger = sp.GetRequiredService<ILogger<PreferencesStore>>();
            var appPaths = sp.GetRequiredService<IApplicationPaths>();
            return new PreferencesStore(logger, appPaths.DataPath);
        });

        services.AddSingleton<EdlLoader>(sp =>
        {
            var logger = sp.GetRequiredService<ILogger<EdlLoader>>();
            var edlDir = Plugin.Instance?.Configuration.EdlDirectory
                         ?? "/mnt/nfs-media/jellyfilter/edl";
            return new EdlLoader(logger, edlDir);
        });

        services.AddHostedService<FilterTranscodeHook>();
    }
}
