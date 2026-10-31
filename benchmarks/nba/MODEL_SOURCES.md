# Model provenance

- E-BARD YOLOv8n: Gabriele Giudici, E-BARD basketball object detection models. Author model card: https://huggingface.co/GabrieleGiudici/E-BARD-detection-models
- Downloaded file: BODD_yolov8n_0001.pt, revision 3f4789c, stored locally as models/ebard-yolov8n.pt. Model card declares CC BY 4.0. Underlying Ultralytics runtime retains its own licensing.
- Author describes training for basketball, hoop, player and referee detection. Training/test overlap with these 2024 Finals videos has not been established; local comparisons are diagnostic, not an independent published benchmark.
- Official game event facts: NBA scorer reports linked in the per-game JSON. Video files remain user-provided and excluded from Git.

No third-party application code was copied. Only the author-published model weights are loaded for local testing. No training was performed on the tiny diagnostic labels.
