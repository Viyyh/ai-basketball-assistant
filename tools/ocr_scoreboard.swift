import Foundation
import Vision
import AppKit
// One JSON line per image; no online service or external data.
for path in CommandLine.arguments.dropFirst() {
    do {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["en-US"]
        let handler = VNImageRequestHandler(url: URL(fileURLWithPath:path))
        try handler.perform([request])
        let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
        let data = try JSONSerialization.data(withJSONObject: ["path":path,"text":text])
        print(String(data:data,encoding:.utf8)!)
    } catch { fputs("OCR failed: \(error)\n",stderr); exit(1) }
}
