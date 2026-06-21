using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;
using Xunit.Abstractions;
using LocalMangaTranslator;

namespace LocalMangaTranslator.Tests
{
    public class AutosaveTests
    {
        [Fact]
        public void TestJsonAutosaveSerialization()
        {
            var testProjectData = new
            {
                version = "1.0",
                pages = new[]
                {
                    new
                    {
                        pageIndex = 0,
                        boxes = new[]
                        {
                            new
                            {
                                id = "box_1",
                                x = 100,
                                y = 150,
                                w = 80,
                                h = 50,
                                maskType = "Ellipse",
                                maskColor = "#FFFFFF",
                                opacity = 1.0,
                                targetLanguage = "Malay",
                                originalText = "こんにちは",
                                translatedText = "Hello / Apa khabar"
                            }
                        }
                    }
                }
            };

            string json = JsonSerializer.Serialize(testProjectData);
            Assert.Contains("box_1", json);
            Assert.Contains("Apa khabar", json);

            using (JsonDocument doc = JsonDocument.Parse(json))
            {
                var root = doc.RootElement;
                Assert.Equal("1.0", root.GetProperty("version").GetString());
                var pages = root.GetProperty("pages");
                Assert.Equal(1, pages.GetArrayLength());
                var page = pages[0];
                Assert.Equal(0, page.GetProperty("pageIndex").GetInt32());
                var boxes = page.GetProperty("boxes");
                Assert.Equal(1, boxes.GetArrayLength());
                Assert.Equal("Ellipse", boxes[0].GetProperty("maskType").GetString());
            }
        }
    }

    public class BridgeTests
    {
        private readonly ITestOutputHelper _output;

        public BridgeTests(ITestOutputHelper output)
        {
            _output = output;
        }

        [Fact]
        public async Task TestBridgeDiagnosticsSuite()
        {
            // Set up bridge
            var bridge = new Bridge(null!);
            
            // Run diagnostics
            string reportJson = await bridge.RunDiagnosticSuite();
            _output.WriteLine("Diagnostic Report: " + reportJson);
            Assert.NotEmpty(reportJson);

            using (JsonDocument doc = JsonDocument.Parse(reportJson))
            {
                var root = doc.RootElement;
                
                // Assert that the diagnostics schema is correct and has all required properties
                Assert.True(root.TryGetProperty("OllamaConnection", out _));
                Assert.True(root.TryGetProperty("ModelLoaded", out _));
                Assert.True(root.TryGetProperty("VlmInference", out _));
                Assert.True(root.TryGetProperty("PdfEngineOk", out _));
                Assert.True(root.TryGetProperty("DiskWriteOk", out _));

                // Assert values
                bool diskOk = root.GetProperty("DiskWriteOk").GetBoolean();
                bool pdfOk = root.GetProperty("PdfEngineOk").GetBoolean();

                _output.WriteLine($"diskOk: {diskOk}, pdfOk: {pdfOk}");
                if (!pdfOk)
                {
                    _output.WriteLine("PDF Error: " + root.GetProperty("PdfError").GetString());
                }
                if (!diskOk)
                {
                    _output.WriteLine("Disk Error: " + root.GetProperty("DiskError").GetString());
                }

                Assert.True(diskOk);
                Assert.True(pdfOk);
            }
        }
    }
}
