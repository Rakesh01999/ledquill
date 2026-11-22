"""Stage 2b: OCR for scanned pages and images (OpenCV preprocessing + Tesseract)."""

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import pytesseract
from PIL import Image, ImageOps, ImageSequence, UnidentifiedImageError

from app.core.errors import PermanentError, TransientError

MIN_SKEW_DEGREES = 0.5  # below this, rotating only adds interpolation blur
MAX_SKEW_DEGREES = 15.0  # beyond this the estimate is unreliable, so leave the page alone
LOW_CONFIDENCE = 60.0
TESSERACT_TIMEOUT_S = 120


@dataclass(frozen=True)
class OcrResult:
    text: str
    confidence: float  # mean word confidence, 0-100


def estimate_skew(gray: np.ndarray) -> float:
    """Skew angle in degrees from the minimum-area rectangle around the text pixels."""
    blurred = cv2.medianBlur(gray, 3)  # keeps speckle from stretching the rectangle
    _, ink = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    points = cv2.findNonZero(ink)
    if points is None or len(points) < 50:
        return 0.0
    angle = cv2.minAreaRect(points)[2]
    if angle > 45:
        angle -= 90
    elif angle < -45:
        angle += 90
    return float(angle)


def deskew(gray: np.ndarray) -> np.ndarray:
    angle = estimate_skew(gray)
    if abs(angle) < MIN_SKEW_DEGREES or abs(angle) > MAX_SKEW_DEGREES:
        return gray
    height, width = gray.shape
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
    return cv2.warpAffine(
        gray, matrix, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )


def preprocess(gray: np.ndarray) -> np.ndarray:
    """grayscale in -> deskew -> denoise (median 3) -> adaptive threshold."""
    straight = deskew(gray)
    denoised = cv2.medianBlur(straight, 3)
    return cv2.adaptiveThreshold(
        denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
    )


def _run_tesseract(image: np.ndarray, psm: int) -> OcrResult:
    try:
        data = pytesseract.image_to_data(
            image,
            config=f"--oem 1 --psm {psm}",
            output_type=pytesseract.Output.DICT,
            timeout=TESSERACT_TIMEOUT_S,
        )
    except pytesseract.TesseractNotFoundError as exc:
        raise PermanentError("The OCR engine is not installed on the server.") from exc
    except (pytesseract.TesseractError, RuntimeError) as exc:
        raise TransientError("OCR engine failed or timed out") from exc
    lines: dict[tuple[int, int, int], list[str]] = {}
    confidences: list[float] = []
    for i, word in enumerate(data["text"]):
        conf = float(data["conf"][i])
        if conf < 0 or not word.strip():
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        lines.setdefault(key, []).append(word)
        confidences.append(conf)
    text = "\n".join(" ".join(words) for words in lines.values())
    mean = sum(confidences) / len(confidences) if confidences else 0.0
    return OcrResult(text=text, confidence=round(mean, 1))


def ocr_image(gray: np.ndarray) -> OcrResult:
    """OCR a grayscale page. Tries --psm 6 and, if confidence is low, --psm 4."""
    prepared = preprocess(gray)
    result = _run_tesseract(prepared, 6)
    if result.confidence < LOW_CONFIDENCE:
        alternative = _run_tesseract(prepared, 4)
        if alternative.confidence > result.confidence:
            return alternative
    return result


def open_image(path: Path, max_frames: int, max_pixels: int) -> Image.Image:
    """Open an image and validate it. Corrupt files, too many frames or too many pixels
    raise PermanentError."""
    Image.MAX_IMAGE_PIXELS = max_pixels  # Pillow warns above this and raises above 2x
    try:
        img = Image.open(path)
        frames = getattr(img, "n_frames", 1)
    except Image.DecompressionBombError as exc:
        raise PermanentError("This image is too large to process.") from exc
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise PermanentError("This image is damaged and cannot be read.") from exc
    if frames > max_frames:
        img.close()
        raise PermanentError(f"This image has {frames} frames; the limit is {max_frames}.")
    return img


def iter_gray_frames(img: Image.Image, max_pixels: int) -> Iterator[np.ndarray]:
    """Yield each frame as a grayscale uint8 array, one at a time."""
    try:
        for frame in ImageSequence.Iterator(img):
            if frame.width * frame.height > max_pixels:
                raise PermanentError(
                    f"This image is too large ({frame.width}x{frame.height} pixels)."
                )
            yield _to_gray(frame)
    except Image.DecompressionBombError as exc:
        raise PermanentError("This image is too large to process.") from exc
    except (OSError, SyntaxError) as exc:
        raise PermanentError("This image is damaged and cannot be read.") from exc
    finally:
        img.close()


def _to_gray(frame: Image.Image) -> np.ndarray:
    frame = ImageOps.exif_transpose(frame)
    if "A" in frame.getbands() or frame.mode == "P":
        rgba = frame.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        frame = Image.alpha_composite(background, rgba)
    return np.asarray(frame.convert("L"))
