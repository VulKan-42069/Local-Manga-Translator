using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace LocalMangaTranslator
{
    /// <summary>
    /// Interaction logic for MainWindow.xaml
    /// </summary>
    public partial class MainWindow : Window
    {
        private Bridge? _bridge;

        public MainWindow()
        {
            InitializeComponent();
            Loaded += MainWindow_Loaded;
            Closing += MainWindow_Closing;
            Closed += MainWindow_Closed;
            AppDomain.CurrentDomain.ProcessExit += CurrentDomain_ProcessExit;
        }

        private void MainWindow_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
        {
            _bridge?.StopOllamaServer();
        }

        private void MainWindow_Closed(object? sender, EventArgs e)
        {
            _bridge?.StopOllamaServer();
        }

        private void CurrentDomain_ProcessExit(object? sender, EventArgs e)
        {
            _bridge?.StopOllamaServer();
        }

        private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            await InitializeWebViewAsync();
        }

        private async Task InitializeWebViewAsync()
        {
            try
            {
                // Create WebView2 environment
                var env = await CoreWebView2Environment.CreateAsync(null, null, null);
                await webView.EnsureCoreWebView2Async(env);

                // Set up virtual host mapping for the local "web" directory
                string appDir = AppDomain.CurrentDomain.BaseDirectory;
                string webFolder = Path.Combine(appDir, "web");
                if (!Directory.Exists(webFolder))
                {
                    // Walk up to find project root if running from bin/Debug/net8.0-windows...
                    string? parentDir = Directory.GetParent(appDir)?.Parent?.Parent?.FullName;
                    if (parentDir != null && Directory.Exists(Path.Combine(parentDir, "web")))
                    {
                        webFolder = Path.Combine(parentDir, "web");
                    }
                }

                // If still not exist, fallback to base dir
                if (!Directory.Exists(webFolder))
                {
                    Directory.CreateDirectory(webFolder);
                }

                // Map http://app.local/ to the local folder
                webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "app.local",
                    webFolder,
                    CoreWebView2HostResourceAccessKind.Allow);

                // Initialize bridge and expose it
                _bridge = new Bridge(this);
                webView.CoreWebView2.AddHostObjectToScript("bridge", _bridge);

                // Set options
                webView.CoreWebView2.Settings.AreDevToolsEnabled = true;
                webView.CoreWebView2.Settings.IsStatusBarEnabled = false;

                // Load page
                webView.CoreWebView2.Navigate("http://app.local/index.html");
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Error initializing WebView2: {ex.Message}\nMake sure WebView2 Runtime is installed.", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }
    }
}