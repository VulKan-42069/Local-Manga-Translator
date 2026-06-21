# ⛩️ Local Manga Translator

A high-performance, offline-first Windows desktop application for translating Japanese manga into English or Malay. It combines **Windows Native OCR** with local **Multimodal Vision-Language Models (VLMs)** running via Ollama for private, fast, and high-fidelity translations.

Developed with a premium **Ruby Light Editorial Theme**—featuring sharp, geometric layouts, thick solid borders, and tactile offset shadows.

---

## ✨ Key Features

*   **👁️ Offline Multimodal Translation (VLM):** Automatically crops speech bubbles and feeds them directly to your local Ollama vision model (such as `gemma4:12b-it-qat` or `llama3.2-vision`) to translate text in visual context.
*   **🛡️ Text-Only Fallback Engine:** If image crops fail or GPU VRAM is cold-starting, the app automatically falls back to translating the OCR text directly, ensuring no bubble is ever left blank.
*   **🔍 Native Windows OCR:** Uses Windows' native high-performance OCR engine (`Windows.Media.Ocr`) to scan and transcribe Japanese text.
*   **🧩 Layout-Aware Clustering:** Proximity clustering merges segmented vertical Japanese columns or horizontal lines into unified bubble paragraphs, preserving natural reading flow (right-to-left for vertical Japanese).
*   **📏 Responsive Typesetting:** Dynamically scales font sizes (using a simulated text-wrapping layout algorithm) so translated text fits speech bubbles perfectly without overflow.
*   **🎨 Bubble Editor & Masking:** Change text colors, fonts (defaults to offline *Comic Neue*), line heights, alignment, bold/italic states, and apply rectangular/elliptical white-out masking opacity.
*   **📂 Async Page Previews:** The left explorer sidebar loads real-time page thumbnails asynchronously, keeping project loads instant and visually navigable.
*   **📄 High-Resolution Export:** Compiles typeset overlays back into original multi-page PDFs (via `PdfSharp`) or single images.
*   **🛠️ Diagnostics & Self-Test:** Built-in health check dashboard verifying Ollama connectivity, VLM latency, PDF libraries, and Windows Japanese language support.

---

## 🛠️ Technology Stack

*   **Core Desktop Shell:** WPF (.NET 8.0, targeting `net8.0-windows10.0.19041.0` for WinRT API access)
*   **Rendering Sandbox:** WebView2 Runtime (communicating via a secure, bi-directional asynchronous C# JSON bridge)
*   **Frontend UI:** Vanilla HTML5, CSS3 Custom Properties, and Javascript Canvas API
*   **PDF Compiler:** PdfSharp
*   **Typography:** Comic Neue (Local offline TTF integration)

---

## 🚀 Prerequisites

### 1. Ollama & Vision Model
Ensure Ollama is installed and running on your local machine.
1. Download Ollama from [ollama.com](https://ollama.com).
2. Pull a multimodal vision model. The default is `gemma4:12b-it-qat`, but you can use `gemma2`, `llama3.2-vision`, or any other model. Configure your model name in the application's **Settings** tab.
   ```bash
   ollama pull gemma4:12b-it-qat
   ```

### 2. Windows Japanese OCR Pack
The native OCR engine requires the Windows Japanese Language Pack.
1. Open Windows **Settings** ➔ **Time & Language** ➔ **Language & Region**.
2. Click **Add a language** ➔ Search for **Japanese** ➔ Install the language pack.
3. Ensure **Optical Character Recognition (OCR)** is checked during installation.

---

## 📥 Getting Started & Installation

Clone the repository and compile using the .NET CLI:

```powershell
# Clone the repository
git clone https://github.com/yourusername/LocalMangaTranslator.git
cd LocalMangaTranslator

# Build the project (Release mode)
dotnet build -c Release

# Run the desktop app
dotnet run
```

---

## 📖 How to Use

1.  **Load Document:** Click **LOAD FILE** (select a PDF, JPG, PNG, WEBP) or **LOAD FOLDER** to open a directory of manga pages.
2.  **Visual Sidebar:** Select pages using the asynchronous image thumbnail preview panel on the left.
3.  **Auto Translate:** Choose your target language (English or Malay) and click **AUTO TRANSLATE** at the top. The app will:
    *   Detect text speech bubbles using Windows OCR.
    *   Merge lines into unified paragraphs.
    *   Translate them visually in parallel using your VLM.
    *   Automatically apply typesetting masks.
4.  **Refine Layouts (Manual Tweaks):**
    *   **Move/Resize:** Click and drag bubbles to adjust their boundaries.
    *   **Draw Bubble:** Click and drag on empty space to manually add a new bubble box.
    *   **Translate Single:** Click **TRANSLATE WITH GEMMA 4** in the editor tab to re-run translation on a selected bubble.
    *   **Styling:** Adjust font sizes, masking shape (Rectangle/Ellipse/None), mask colors, and alignment inside the **Editor** panel.
5.  **Export:** Click **EXPORT CURRENT** to compile the pages into a finalized translated PDF or typeset images.

---

## 🧪 Running Unit Tests

To run the automated xUnit backend testing suite (verifying JSON project saves, coordinate transformations, and bridge connectivity):

```powershell
dotnet test LocalMangaTranslator.Tests/LocalMangaTranslator.Tests.csproj
```
