using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Win32;
using System.Runtime.InteropServices;
using Windows.Data.Pdf;
using Windows.Storage;
using Windows.Storage.Streams;
using Windows.Media.Ocr;
using PdfSharp.Pdf;
using PdfSharp.Drawing;
using System.Diagnostics;

namespace LocalMangaTranslator
{
    [ComVisible(true)]
    [ClassInterface(ClassInterfaceType.None)]
    public class Bridge
    {
        private readonly MainWindow _mainWindow;
        private readonly HttpClient _httpClient;
        private string _tempFolder;

        public Bridge(MainWindow mainWindow)
        {
            _mainWindow = mainWindow;
            _httpClient = new HttpClient();
            _tempFolder = Path.Combine(Path.GetTempPath(), "LocalMangaTranslator");
            if (!Directory.Exists(_tempFolder))
            {
                Directory.CreateDirectory(_tempFolder);
            }
        }

        // 1. Select File (Images or PDFs)
        public string SelectFile()
        {
            var openFileDialog = new OpenFileDialog
            {
                Filter = "Manga Files (*.pdf;*.png;*.jpg;*.jpeg;*.webp)|*.pdf;*.png;*.jpg;*.jpeg;*.webp|All Files (*.*)|*.*",
                Title = "Select Manga File (PDF or Image)"
            };

            if (openFileDialog.ShowDialog() == true)
            {
                return openFileDialog.FileName;
            }
            return string.Empty;
        }

        // 2. Select Folder
        public string SelectFolder()
        {
            var dialog = new OpenFolderDialog
            {
                Title = "Select Folder containing Manga Images"
            };

            if (dialog.ShowDialog() == true)
            {
                return dialog.FolderName;
            }
            return string.Empty;
        }

        // 3. Load Document (PDF or single image, or folder contents)
        // Returns a JSON-serialized string of image URLs/paths to WebView2
        public async Task<string> LoadDocument(string filePath)
        {
            try
            {
                if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath))
                {
                    return MakeErrorResponse("File does not exist.");
                }

                string ext = Path.GetExtension(filePath).ToLower();

                if (ext == ".pdf")
                {
                    // Render PDF to temporary PNG files
                    string pdfTempDir = Path.Combine(_tempFolder, Path.GetFileNameWithoutExtension(filePath) + "_" + Guid.NewGuid().ToString().Substring(0, 8));
                    Directory.CreateDirectory(pdfTempDir);

                    using (var fileStream = File.OpenRead(filePath))
                    using (var randomStream = fileStream.AsRandomAccessStream())
                    {
                        var pdfDocument = await Windows.Data.Pdf.PdfDocument.LoadFromStreamAsync(randomStream);
                        uint pageCount = pdfDocument.PageCount;
                        string[] pagePaths = new string[pageCount];

                        for (uint i = 0; i < pageCount; i++)
                        {
                            using (var page = pdfDocument.GetPage(i))
                            {
                                string pagePath = Path.Combine(pdfTempDir, $"page_{i}.png");
                                using (var outStream = new FileStream(pagePath, FileMode.Create, FileAccess.ReadWrite))
                                using (var randomOutStream = outStream.AsRandomAccessStream())
                                {
                                    var options = new PdfPageRenderOptions();
                                    // Double size for high resolution and clean text OCR/rendering
                                    options.DestinationWidth = (uint)(page.Size.Width * 2);
                                    options.DestinationHeight = (uint)(page.Size.Height * 2);
                                    await page.RenderToStreamAsync(randomOutStream, options);
                                    await randomOutStream.FlushAsync();
                                }
                                // Normalize backslashes for JS consumption
                                pagePaths[i] = pagePath.Replace('\\', '/');
                            }
                        }

                        var responseObj = new
                        {
                            type = "pdf",
                            originalPath = filePath.Replace('\\', '/'),
                            pages = pagePaths
                        };
                        return JsonSerializer.Serialize(responseObj);
                    }
                }
                else if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".webp")
                {
                    // Single image file
                    var responseObj = new
                    {
                        type = "image",
                        originalPath = filePath.Replace('\\', '/'),
                        pages = new string[] { filePath.Replace('\\', '/') }
                    };
                    return JsonSerializer.Serialize(responseObj);
                }
                else
                {
                    return MakeErrorResponse("Unsupported file format.");
                }
            }
            catch (Exception ex)
            {
                return MakeErrorResponse($"Error loading document: {ex.Message}");
            }
        }

        // List images in a directory
        public string GetImagesInFolder(string folderPath)
        {
            try
            {
                if (string.IsNullOrEmpty(folderPath) || !Directory.Exists(folderPath))
                {
                    return MakeErrorResponse("Folder does not exist.");
                }

                string[] validExtensions = { ".png", ".jpg", ".jpeg", ".webp" };
                var files = Directory.GetFiles(folderPath)
                                     .Where(file => validExtensions.Contains(Path.GetExtension(file).ToLower()))
                                     .Select(file => file.Replace('\\', '/'))
                                     .ToArray();

                var responseObj = new
                {
                    type = "folder",
                    originalPath = folderPath.Replace('\\', '/'),
                    pages = files
                };
                return JsonSerializer.Serialize(responseObj);
            }
            catch (Exception ex)
            {
                return MakeErrorResponse($"Error listing folder images: {ex.Message}");
            }
        }

        // 4. Load Image As Base64
        public string LoadImageAsBase64(string filePath)
        {
            try
            {
                if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath))
                {
                    return string.Empty;
                }

                byte[] bytes = File.ReadAllBytes(filePath);
                string base64 = Convert.ToBase64String(bytes);
                string mimeType = "image/png";
                string ext = Path.GetExtension(filePath).ToLower();
                if (ext == ".jpg" || ext == ".jpeg") mimeType = "image/jpeg";
                else if (ext == ".webp") mimeType = "image/webp";

                return $"data:{mimeType};base64,{base64}";
            }
            catch (Exception)
            {
                return string.Empty;
            }
        }
        private static byte[] PreprocessImageForOcr(string imagePath)
        {
            try
            {
                using (var src = new System.Drawing.Bitmap(imagePath))
                {
                    int width = src.Width;
                    int height = src.Height;
                    
                    using (var bmp = new System.Drawing.Bitmap(width, height, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
                    {
                        using (var g = System.Drawing.Graphics.FromImage(bmp))
                        {
                            g.DrawImage(src, 0, 0, width, height);
                        }
                        
                        var rect = new System.Drawing.Rectangle(0, 0, width, height);
                        var bmpData = bmp.LockBits(rect, System.Drawing.Imaging.ImageLockMode.ReadWrite, bmp.PixelFormat);
                        
                        int bytes = Math.Abs(bmpData.Stride) * height;
                        byte[] rgbValues = new byte[bytes];
                        System.Runtime.InteropServices.Marshal.Copy(bmpData.Scan0, rgbValues, 0, bytes);
                        
                        int stride = bmpData.Stride;
                        
                        Func<int, int, bool> isBlack = (x, y) =>
                        {
                            int idx = y * stride + x * 4;
                            return rgbValues[idx] < 130 && rgbValues[idx + 1] < 130 && rgbValues[idx + 2] < 130;
                        };
                        
                        var toErase = new System.Collections.Generic.List<int>();
                        int radius = 4;
                        int maxCount = 10;
                        
                        for (int y = radius; y < height - radius; y += 2)
                        {
                            for (int x = radius; x < width - radius; x += 2)
                            {
                                if (isBlack(x, y))
                                {
                                    int blackCount = 0;
                                    for (int ny = -radius; ny <= radius; ny++)
                                    {
                                        for (int nx = -radius; nx <= radius; nx++)
                                        {
                                            if (isBlack(x + nx, y + ny))
                                            {
                                                blackCount++;
                                            }
                                        }
                                    }
                                    
                                    if (blackCount < maxCount)
                                    {
                                        for (int ey = -2; ey <= 2; ey++)
                                        {
                                            for (int ex = -2; ex <= 2; ex++)
                                            {
                                                int px = x + ex;
                                                int py = y + ey;
                                                if (px >= 0 && px < width && py >= 0 && py < height)
                                                {
                                                    int idx = py * stride + px * 4;
                                                    toErase.Add(idx);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        
                        foreach (int idx in toErase)
                        {
                            rgbValues[idx] = 255;
                            rgbValues[idx + 1] = 255;
                            rgbValues[idx + 2] = 255;
                        }
                        
                        System.Runtime.InteropServices.Marshal.Copy(rgbValues, 0, bmpData.Scan0, bytes);
                        bmp.UnlockBits(bmpData);
                        
                        using (var ms = new MemoryStream())
                        {
                            bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
                            return ms.ToArray();
                        }
                    }
                }
            }
            catch
            {
                return File.ReadAllBytes(imagePath);
            }
        }

        // Native Windows OCR bubble text detector
        public async Task<string> AutoDetectText(string imagePath)
        {
            try
            {
                if (string.IsNullOrEmpty(imagePath) || !File.Exists(imagePath))
                {
                    return "[]";
                }

                // Check if Japanese OCR is supported before continuing
                var jaLanguage = new Windows.Globalization.Language("ja-JP");
                if (!Windows.Media.Ocr.OcrEngine.IsLanguageSupported(jaLanguage))
                {
                    return MakeErrorResponse("Japanese OCR language pack is not installed on this PC.\n\n" +
                                             "To translate Japanese manga automatically, please add the Japanese language pack:\n" +
                                             "1. Open Windows Settings (Win+I).\n" +
                                             "2. Go to 'Time & Language' -> 'Language & Region' (or 'Language').\n" +
                                             "3. Click 'Add a language' and select 'Japanese'.\n" +
                                             "4. Click Options next to Japanese and ensure 'Optical Character Recognition' (or 'Basic typing') is checked and installed.\n" +
                                             "5. Restart this application.");
                }

                byte[] preprocessedPngBytes = PreprocessImageForOcr(imagePath);

                using (var ms = new MemoryStream(preprocessedPngBytes))
                using (var randomStream = ms.AsRandomAccessStream())
                {
                    var decoder = await Windows.Graphics.Imaging.BitmapDecoder.CreateAsync(randomStream);
                    using (var softwareBitmap = await decoder.GetSoftwareBitmapAsync())
                    {
                        OcrEngine ocrEngine = OcrEngine.TryCreateFromLanguage(jaLanguage);
                        if (ocrEngine == null)
                        {
                            return MakeErrorResponse("No OCR engine is available on this system.");
                        }

                        var ocrResult = await ocrEngine.RecognizeAsync(softwareBitmap);
                        
                        var detectedLines = ocrResult.Lines.Select(line => {
                            var words = line.Words;
                            if (words == null || words.Count == 0)
                            {
                                return new OcrLine
                                {
                                    Text = line.Text,
                                    X = 0.0,
                                    Y = 0.0,
                                    Width = 0.0,
                                    Height = 0.0
                                };
                            }

                            double minX = words.Min(w => w.BoundingRect.X);
                            double minY = words.Min(w => w.BoundingRect.Y);
                            double maxX = words.Max(w => w.BoundingRect.X + w.BoundingRect.Width);
                            double maxY = words.Max(w => w.BoundingRect.Y + w.BoundingRect.Height);

                            return new OcrLine
                            {
                                Text = line.Text,
                                X = minX,
                                Y = minY,
                                Width = maxX - minX,
                                Height = maxY - minY
                            };
                        }).ToList();

                        var mergedBlocks = MergeOcrLines(detectedLines);

                        var resultBlocks = mergedBlocks.Select(b => new {
                            text = b.Text,
                            x = b.X,
                            y = b.Y,
                            w = b.Width,
                            h = b.Height
                        }).ToArray();

                        return JsonSerializer.Serialize(resultBlocks);
                    }
                }
            }
            catch (Exception ex)
            {
                return MakeErrorResponse($"OCR detection failed: {ex.Message}");
            }
        }
        // 5. Load Project Autosave File
        public string LoadProject(string filePath)
        {
            try
            {
                if (string.IsNullOrEmpty(filePath)) return string.Empty;
                string projectPath = GetProjectPath(filePath);
                if (File.Exists(projectPath))
                {
                    return File.ReadAllText(projectPath);
                }
            }
            catch (Exception)
            {
                // Ignore load errors and return empty
            }
            return string.Empty;
        }

        // 6. Save Project Autosave File
        public bool SaveProject(string filePath, string jsonContent)
        {
            try
            {
                if (string.IsNullOrEmpty(filePath)) return false;
                string projectPath = GetProjectPath(filePath);
                string dir = Path.GetDirectoryName(projectPath) ?? Path.GetTempPath();
                if (!Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }
                File.WriteAllText(projectPath, jsonContent);
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        // Helper to map project file path
        private string GetProjectPath(string filePath)
        {
            string dir = Path.GetDirectoryName(filePath) ?? Path.GetTempPath();
            string name = Path.GetFileNameWithoutExtension(filePath);
            return Path.Combine(dir, $"{name}_translation.json");
        }

        // 7. Proxy calls to Local Ollama
        public async Task<string> CallOllama(string endpoint, string payloadJson)
        {
            try
            {
                var content = new StringContent(payloadJson, Encoding.UTF8, "application/json");
                var response = await _httpClient.PostAsync($"http://127.0.0.1:11434{endpoint}", content);
                string responseBody = await response.Content.ReadAsStringAsync();
                
                if (response.IsSuccessStatusCode)
                {
                    return responseBody;
                }
                return MakeErrorResponse($"Ollama returned status: {response.StatusCode}. Details: {responseBody}");
            }
            catch (Exception ex)
            {
                return MakeErrorResponse($"Error calling local Ollama server: {ex.Message}");
            }
        }

        // 8. Save/Export translated documents
        // base64PagesJson is a JSON array of base64 strings
        public string ExportTranslatedDocument(string originalPath, string base64PagesJson)
        {
            try
            {
                if (string.IsNullOrEmpty(originalPath) || string.IsNullOrEmpty(base64PagesJson))
                {
                    return MakeErrorResponse("Invalid parameters.");
                }

                string[]? base64Pages = JsonSerializer.Deserialize<string[]>(base64PagesJson);
                if (base64Pages == null || base64Pages.Length == 0)
                {
                    return MakeErrorResponse("No pages provided for export.");
                }

                string dir = Path.GetDirectoryName(originalPath) ?? string.Empty;
                string filename = Path.GetFileNameWithoutExtension(originalPath);
                string ext = Path.GetExtension(originalPath).ToLower();

                if (ext == ".pdf")
                {
                    string outputPath = Path.Combine(dir, $"{filename}_translated.pdf");
                    using (PdfSharp.Pdf.PdfDocument outputDoc = new PdfSharp.Pdf.PdfDocument())
                    {
                        foreach (var base64Page in base64Pages)
                        {
                            string rawBase64 = base64Page.Substring(base64Page.IndexOf(",") + 1);
                            byte[] imageBytes = Convert.FromBase64String(rawBase64);

                            using (MemoryStream ms = new MemoryStream(imageBytes))
                            {
                                // Add page to PDF
                                PdfSharp.Pdf.PdfPage pdfPage = outputDoc.AddPage();
                                using (XImage image = XImage.FromStream(ms))
                                {
                                    // Set page dimensions to match image aspect ratio
                                    pdfPage.Width = XUnit.FromPoint(image.PixelWidth * 72.0 / 96.0);
                                    pdfPage.Height = XUnit.FromPoint(image.PixelHeight * 72.0 / 96.0);

                                    using (XGraphics gfx = XGraphics.FromPdfPage(pdfPage))
                                    {
                                        gfx.DrawImage(image, 0, 0, pdfPage.Width, pdfPage.Height);
                                    }
                                }
                            }
                        }
                        outputDoc.Save(outputPath);
                    }
                    return outputPath.Replace('\\', '/');
                }
                else
                {
                    // Single image export
                    string rawBase64 = base64Pages[0].Substring(base64Pages[0].IndexOf(",") + 1);
                    byte[] imageBytes = Convert.FromBase64String(rawBase64);
                    
                    string outputPath = Path.Combine(dir, $"{filename}_translated{ext}");
                    File.WriteAllBytes(outputPath, imageBytes);
                    return outputPath.Replace('\\', '/');
                }
            }
            catch (Exception ex)
            {
                return MakeErrorResponse($"Error exporting document: {ex.Message}");
            }
        }

        public bool IsOllamaRunning()
        {
            var processes = Process.GetProcessesByName("ollama");
            return processes.Length > 0;
        }

        public async Task<bool> IsOllamaApiResponding()
        {
            try
            {
                var response = await _httpClient.GetAsync("http://127.0.0.1:11434/");
                return response.IsSuccessStatusCode;
            }
            catch
            {
                return false;
            }
        }

        public async Task<bool> StartOllamaServer()
        {
            try
            {
                if (IsOllamaRunning()) return true;

                string ollamaExe = @"j:\AI_OLLAMA\bin\ollama.exe";
                string baseDir = @"j:\AI_OLLAMA";

                if (File.Exists(ollamaExe))
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = ollamaExe,
                        Arguments = "serve",
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };

                    // Load custom environment variables to enforce execution in J:\AI_OLLAMA\
                    psi.EnvironmentVariables["USERPROFILE"] = Path.Combine(baseDir, "user");
                    psi.EnvironmentVariables["HOME"] = Path.Combine(baseDir, "user");
                    psi.EnvironmentVariables["LOCALAPPDATA"] = Path.Combine(baseDir, "localappdata");
                    psi.EnvironmentVariables["APPDATA"] = Path.Combine(baseDir, "appdata");
                    psi.EnvironmentVariables["TEMP"] = Path.Combine(baseDir, "tmp");
                    psi.EnvironmentVariables["TMP"] = Path.Combine(baseDir, "tmp");
                    psi.EnvironmentVariables["OLLAMA_MODELS"] = Path.Combine(baseDir, "models");
                    psi.EnvironmentVariables["OLLAMA_HOME"] = Path.Combine(baseDir, "user");
                    psi.EnvironmentVariables["HOMEDRIVE"] = "j:";
                    psi.EnvironmentVariables["HOMEPATH"] = @"\AI_OLLAMA\user";

                    Process.Start(psi);
                    await Task.Delay(4000); // Wait for server startup

                    if (IsOllamaRunning()) return true;
                }

                // Fallback: Run start_server.ps1 on J:\AI_OLLAMA\
                string scriptPath = @"j:\AI_OLLAMA\start_server.ps1";
                if (File.Exists(scriptPath))
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = "powershell.exe",
                        Arguments = $"-ExecutionPolicy Bypass -File \"{scriptPath}\"",
                        UseShellExecute = false,
                        CreateNoWindow = true
                        // Note: Do NOT redirect stdout/stderr to prevent buffer-fill hangs.
                    };

                    Process.Start(psi);
                    await Task.Delay(4000);
                }

                return IsOllamaRunning();
            }
            catch (Exception)
            {
                return false;
            }
        }

        public void StopOllamaServer()
        {
            try
            {
                // Kill ollama processes and their trees
                var ollamaProcesses = Process.GetProcessesByName("ollama");
                foreach (var process in ollamaProcesses)
                {
                    try
                    {
                        process.Kill(true); // Kill entire process tree
                        process.WaitForExit(1000);
                    }
                    catch { }
                }

                // Kill any orphaned llama-server processes
                var llamaProcesses = Process.GetProcessesByName("llama-server");
                foreach (var process in llamaProcesses)
                {
                    try
                    {
                        process.Kill(true); // Kill entire process tree
                        process.WaitForExit(1000);
                    }
                    catch { }
                }
            }
            catch { }
        }

        // 10. Self-Test/Diagnostics runner
        public async Task<string> RunDiagnosticSuite()
        {
            var report = new DiagnosticReport();
            
            // Test 1: Check Ollama connection
            try
            {
                var response = await _httpClient.GetAsync("http://127.0.0.1:11434/");
                report.OllamaConnection = response.IsSuccessStatusCode;
                report.OllamaError = report.OllamaConnection ? "" : $"Ollama server returned: {response.StatusCode}";
            }
            catch (Exception ex)
            {
                report.OllamaConnection = false;
                report.OllamaError = ex.Message;
            }

            // Test 2: Check Model
            if (report.OllamaConnection)
            {
                try
                {
                    var response = await _httpClient.GetAsync("http://127.0.0.1:11434/api/tags");
                    if (response.IsSuccessStatusCode)
                    {
                        string body = await response.Content.ReadAsStringAsync();
                        using (JsonDocument doc = JsonDocument.Parse(body))
                        {
                            var models = doc.RootElement.GetProperty("models");
                            bool hasGemma = false;
                            foreach (var model in models.EnumerateArray())
                            {
                                string? name = model.GetProperty("name").GetString();
                                if (name != null && name.Contains("gemma4:12b-it-qat"))
                                {
                                    hasGemma = true;
                                    break;
                                }
                            }
                            report.ModelLoaded = hasGemma;
                            report.ModelError = hasGemma ? "" : "gemma4:12b-it-qat is not registered in local Ollama.";
                        }
                    }
                    else
                    {
                        report.ModelLoaded = false;
                        report.ModelError = $"Tags API returned: {response.StatusCode}";
                    }
                }
                catch (Exception ex)
                {
                    report.ModelLoaded = false;
                    report.ModelError = ex.Message;
                }
            }
            else
            {
                report.ModelLoaded = false;
                report.ModelError = "Skipped (Ollama Connection failed).";
            }

            // Test 3: VLM Test (only if model loaded)
            if (report.ModelLoaded)
            {
                try
                {
                    // A fast text check to verify model inference is functioning
                    var testRequestObj = new
                    {
                        model = "gemma4:12b-it-qat",
                        messages = new[]
                        {
                            new { role = "user", content = "ping" }
                        },
                        stream = false
                    };
                    string reqJson = JsonSerializer.Serialize(testRequestObj);
                    var content = new StringContent(reqJson, Encoding.UTF8, "application/json");
                    var sw = Stopwatch.StartNew();
                    var response = await _httpClient.PostAsync("http://127.0.0.1:11434/api/chat", content);
                    sw.Stop();

                    if (response.IsSuccessStatusCode)
                    {
                        report.VlmInference = true;
                        report.VlmLatencyMs = sw.ElapsedMilliseconds;
                        report.VlmError = "";
                    }
                    else
                    {
                        report.VlmInference = false;
                        report.VlmError = $"VLM Test API returned: {response.StatusCode}";
                    }
                }
                catch (Exception ex)
                {
                    report.VlmInference = false;
                    report.VlmError = ex.Message;
                }
            }
            else
            {
                report.VlmInference = false;
                report.VlmError = "Skipped (Model not found).";
            }

            // Test 4: PDF rendering engine test
            try
            {
                // Create a tiny valid PDF in memory
                using (PdfSharp.Pdf.PdfDocument doc = new PdfSharp.Pdf.PdfDocument())
                {
                    var page = doc.AddPage();
                    using (XGraphics gfx = XGraphics.FromPdfPage(page))
                    {
                        gfx.DrawRectangle(XPens.Black, 50, 50, 100, 100);
                    }
                    string tempPdf = Path.Combine(_tempFolder, "diag_test.pdf");
                    doc.Save(tempPdf);

                    // Try to load and render it using Windows.Data.Pdf
                    using (var fileStream = File.OpenRead(tempPdf))
                    using (var randomStream = fileStream.AsRandomAccessStream())
                    {
                        var pdfDoc = await Windows.Data.Pdf.PdfDocument.LoadFromStreamAsync(randomStream);
                        if (pdfDoc.PageCount > 0)
                        {
                            using (var firstPage = pdfDoc.GetPage(0))
                            {
                                string tempPng = Path.Combine(_tempFolder, "diag_test.png");
                                using (var outStream = new FileStream(tempPng, FileMode.Create, FileAccess.ReadWrite))
                                using (var randomOutStream = outStream.AsRandomAccessStream())
                                {
                                    await firstPage.RenderToStreamAsync(randomOutStream);
                                    await randomOutStream.FlushAsync();
                                }
                                report.PdfEngineOk = File.Exists(tempPng) && new FileInfo(tempPng).Length > 0;
                            }
                        }
                        else
                        {
                            report.PdfEngineOk = false;
                        }
                    }
                    
                    // Cleanup
                    File.Delete(tempPdf);
                    File.Delete(Path.Combine(_tempFolder, "diag_test.png"));
                }
                report.PdfError = "";
            }
            catch (Exception ex)
            {
                report.PdfEngineOk = false;
                report.PdfError = ex.Message;
            }

            // Test 5: Filesystem permission check
            try
            {
                string testPath = Path.Combine(_tempFolder, "perm_check.txt");
                File.WriteAllText(testPath, "test");
                string readText = File.ReadAllText(testPath);
                File.Delete(testPath);
                
                report.DiskWriteOk = readText == "test";
                report.DiskError = "";
            }
            catch (Exception ex)
            {
                report.DiskWriteOk = false;
                report.DiskError = ex.Message;
            }

            // Test 6: Japanese OCR Engine support
            try
            {
                var jaLanguage = new Windows.Globalization.Language("ja-JP");
                if (Windows.Media.Ocr.OcrEngine.IsLanguageSupported(jaLanguage))
                {
                    report.OcrEngineOk = true;
                    report.OcrError = "";
                }
                else
                {
                    report.OcrEngineOk = false;
                    report.OcrError = "Japanese OCR language pack is not installed on this PC.\n" +
                                      "Install it in Windows Settings -> Time & Language -> Language -> Add 'Japanese' (with OCR).";
                }
            }
            catch (Exception ex)
            {
                report.OcrEngineOk = false;
                report.OcrError = ex.Message;
            }

            return JsonSerializer.Serialize(report);
        }

        private string MakeErrorResponse(string message)
        {
            return JsonSerializer.Serialize(new { error = message });
        }

        private System.Collections.Generic.List<OcrBlock> MergeOcrLines(System.Collections.Generic.IEnumerable<OcrLine> detectedLines)
        {
            var blocks = detectedLines.Select(line => new OcrBlock
            {
                X = line.X,
                Y = line.Y,
                Width = line.Width,
                Height = line.Height,
                Lines = new System.Collections.Generic.List<OcrLine> { line }
            }).ToList();

            bool mergedAny = true;
            while (mergedAny)
            {
                mergedAny = false;
                for (int i = 0; i < blocks.Count; i++)
                {
                    for (int j = i + 1; j < blocks.Count; j++)
                    {
                        if (ShouldMerge(blocks[i], blocks[j]))
                        {
                            double minX = Math.Min(blocks[i].X, blocks[j].X);
                            double minY = Math.Min(blocks[i].Y, blocks[j].Y);
                            double maxX = Math.Max(blocks[i].X + blocks[i].Width, blocks[j].X + blocks[j].Width);
                            double maxY = Math.Max(blocks[i].Y + blocks[i].Height, blocks[j].Y + blocks[j].Height);

                            blocks[i].X = minX;
                            blocks[i].Y = minY;
                            blocks[i].Width = maxX - minX;
                            blocks[i].Height = maxY - minY;
                            blocks[i].Lines.AddRange(blocks[j].Lines);

                            blocks.RemoveAt(j);
                            mergedAny = true;
                            break;
                        }
                    }
                    if (mergedAny) break;
                }
            }

            foreach (var block in blocks)
            {
                bool isVertical = true;
                if (block.Lines.Count > 0)
                {
                    double totalWidth = 0;
                    double totalHeight = 0;
                    foreach (var line in block.Lines)
                    {
                        totalWidth += line.Width;
                        totalHeight += line.Height;
                    }
                    double avgWidth = totalWidth / block.Lines.Count;
                    double avgHeight = totalHeight / block.Lines.Count;
                    if (avgWidth > avgHeight * 1.1)
                    {
                        isVertical = false;
                    }
                }

                System.Collections.Generic.List<OcrLine> sortedLines;
                if (isVertical)
                {
                    sortedLines = block.Lines
                        .OrderByDescending(l => l.X)
                        .ThenBy(l => l.Y)
                        .ToList();
                }
                else
                {
                    sortedLines = block.Lines
                        .OrderBy(l => l.Y)
                        .ThenBy(l => l.X)
                        .ToList();
                }

                block.Text = string.Join(isVertical ? "" : " ", sortedLines.Select(l => l.Text.Trim()));

                // 1. Apply layout-aware padding to prevent character clipping and ensure full visual context for VLM
                double padX = isVertical ? 10 : 15;
                double padY = isVertical ? 20 : 10;
                block.X = Math.Max(0, block.X - padX);
                block.Y = Math.Max(0, block.Y - padY);
                block.Width += padX * 2;
                block.Height += padY * 2;

                // 2. Symmetrically expand narrow boxes to a minimum width of 90px so that horizontal translated text fits cleanly
                double minWidth = 90;
                if (block.Width < minWidth)
                {
                    double centerX = block.X + block.Width / 2;
                    block.Width = minWidth;
                    block.X = Math.Max(0, centerX - minWidth / 2);
                }
            }

            return blocks;
        }

        private bool ShouldMerge(OcrBlock b1, OcrBlock b2)
        {
            double gapX = Math.Max(0, Math.Max(b1.X, b2.X) - Math.Min(b1.X + b1.Width, b2.X + b2.Width));
            double overlapX = Math.Min(b1.X + b1.Width, b2.X + b2.Width) - Math.Max(b1.X, b2.X);
            
            double gapY = Math.Max(0, Math.Max(b1.Y, b2.Y) - Math.Min(b1.Y + b1.Height, b2.Y + b2.Height));
            double overlapY = Math.Min(b1.Y + b1.Height, b2.Y + b2.Height) - Math.Max(b1.Y, b2.Y);

            // Determine if they are substantially aligned horizontally (same vertical column)
            double minWidth = Math.Min(b1.Width, b2.Width);
            bool isSameColumn = overlapX > 0 && (overlapX > minWidth * 0.5 || overlapX > 15);

            // Determine if they are substantially aligned vertically (same horizontal line)
            double minHeight = Math.Min(b1.Height, b2.Height);
            bool isSameLine = overlapY > 0 && (overlapY > minHeight * 0.5 || overlapY > 10);

            // 1. Vertical Japanese Layout Merging
            // - Same Column: stack vertical segments (allow up to 100px vertical gap)
            bool verticalSameColumn = isSameColumn && gapY < 100;
            // - Adjacent Columns: side-by-side columns within the same bubble (tight horizontal gap < 40px, vertical overlap)
            bool verticalAdjacentColumns = gapX < 40 && (overlapY > minHeight * 0.2 || gapY < 25);
            bool isVerticalMerge = verticalSameColumn || verticalAdjacentColumns;

            // 2. Horizontal Layout Merging
            // - Same Line: horizontally adjacent segments (allow up to 60px horizontal gap)
            bool horizontalSameLine = isSameLine && gapX < 60;
            // - Adjacent Lines: vertically stacked lines within the same bubble (tight vertical gap < 25px, horizontal overlap)
            bool horizontalAdjacentLines = gapY < 25 && (overlapX > minWidth * 0.2 || gapX < 25);
            bool isHorizontalMerge = horizontalSameLine || horizontalAdjacentLines;

            return isVerticalMerge || isHorizontalMerge;
        }
    }

    public class OcrLine
    {
        public string Text { get; set; } = "";
        public double X { get; set; }
        public double Y { get; set; }
        public double Width { get; set; }
        public double Height { get; set; }
    }

    public class OcrBlock
    {
        public string Text { get; set; } = "";
        public double X { get; set; }
        public double Y { get; set; }
        public double Width { get; set; }
        public double Height { get; set; }
        public System.Collections.Generic.List<OcrLine> Lines { get; set; } = new System.Collections.Generic.List<OcrLine>();
    }

    public class DiagnosticReport
    {
        public bool OllamaConnection { get; set; }
        public string OllamaError { get; set; } = "";
        
        public bool ModelLoaded { get; set; }
        public string ModelError { get; set; } = "";
        
        public bool VlmInference { get; set; }
        public long VlmLatencyMs { get; set; }
        public string VlmError { get; set; } = "";
        
        public bool PdfEngineOk { get; set; }
        public string PdfError { get; set; } = "";
        
        public bool DiskWriteOk { get; set; }
        public string DiskError { get; set; } = "";

        public bool OcrEngineOk { get; set; }
        public string OcrError { get; set; } = "";
    }
}
