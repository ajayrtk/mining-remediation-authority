#!/usr/bin/env python3
"""
Pre-upload validation script for map files
Validates sheet number against georeferencing data before S3 upload
"""

import json
import math
import re
import sys
import tempfile
import zipfile
from pathlib import Path


def is_number(x: str) -> bool:
    """Check if string can be converted to float"""
    try:
        float(x)
        return True
    except ValueError:
        return False


def get_sheet_number_from_filename(filename: str) -> str:
    """
    Extract sheet number from filename using UPDATED LOGIC

    Format: SeamID_SheetNumber[_optional_suffix].zip
    - SeamID: MANDATORY, non-empty alphanumeric (everything before sheet number pattern)
    - Underscore: MANDATORY separator
    - SheetNumber: MANDATORY, exactly 6 digits in format XXXXXX or XX_XXXX

    The parser finds the 6-digit sheet number pattern first, then treats everything before it as the seam ID.

    Valid examples:
    - 16516_433857.zip → sheet=433857 (SeamID=16516)
    - D723_43_3857.zip → sheet=433857 (SeamID=D723)
    - 43_433857.zip → sheet=433857 (SeamID=43)
    - 43_43_3857.zip → sheet=433857 (SeamID=43)
    - 17836_26_9285_UpperHirst.zip → sheet=269285 (SeamID=17836)

    Invalid examples:
    - _453858.zip → None (no seam ID before sheet number)
    - 453858.zip → None (no underscore separator)
    - 16516_4538.zip → None (only 4 digits in sheet number)
    """
    # Remove file extension
    name_without_ext = filename.rsplit('.', 1)[0]

    # Check if underscore exists (MANDATORY)
    if '_' not in name_without_ext:
        return None

    # Look for 6-digit sheet number pattern in two formats:
    # Format 1: XX_XXXX (2 digits + separator + 4 digits)
    # Format 2: XXXXXX (6 consecutive digits)
    # Use negative lookbehind to ensure pattern isn't preceded by digits
    sheet_number_pattern = r'(?<!\d)(\d{2}[-\s_]\d{4}|\d{6})(?=[-\s_]|$)'
    match = re.search(sheet_number_pattern, name_without_ext)

    if not match:
        # No valid sheet number pattern found
        return None

    # Extract sheet number (remove any separators to get 6 digits)
    sheet_number_raw = match.group(1)
    sheet_number = re.sub(r'\D', '', sheet_number_raw)

    # Everything before the sheet number pattern is the seam ID
    sheet_number_start_index = match.start()
    seam_id = name_without_ext[:sheet_number_start_index]

    # Validate seam ID exists and ends with underscore
    if not seam_id or not seam_id.endswith('_'):
        return None

    # Remove trailing underscore from seam ID
    seam_id_clean = seam_id[:-1]

    # Validate seam ID is not empty after removing underscore
    if not seam_id_clean or seam_id_clean.strip() == '':
        return None

    # Validate seam ID contains only alphanumeric characters
    if not re.match(r'^[a-zA-Z0-9]+$', seam_id_clean):
        return None

    return sheet_number


def get_filename_validation_error(filename: str) -> str:
    """
    Generate a detailed error message explaining what's wrong with the filename
    Uses NEW LOGIC: find sheet number pattern first
    """
    # Remove file extension
    name_without_ext = filename.rsplit('.', 1)[0]

    # Check if underscore exists
    if '_' not in name_without_ext:
        return (
            f"Missing mandatory underscore separator. "
            f"Expected format: SeamID_SheetNumber.zip (e.g., '16516_433857.zip')"
        )

    # Look for 6-digit sheet number pattern
    sheet_number_pattern = r'(?<!\d)(\d{2}[-\s_]\d{4}|\d{6})(?=[-\s_]|$)'
    match = re.search(sheet_number_pattern, name_without_ext)

    if not match:
        # No valid sheet number pattern found
        all_digits = re.sub(r'\D', '', name_without_ext)
        if len(all_digits) == 0:
            return (
                f"No digits found. "
                f"Sheet number must be exactly 6 digits in format XXXXXX or XX_XXXX."
            )
        elif len(all_digits) < 6:
            return (
                f"Sheet number must be exactly 6 digits, found {len(all_digits)} digits. "
                f"Expected format: SeamID_SheetNumber.zip (e.g., '16516_433857.zip' or '43_43_3857.zip')"
            )
        else:
            return (
                f"Found {len(all_digits)} digits but sheet number format is incorrect. "
                f"Expected 6 digits in format XXXXXX or XX_XXXX (e.g., '433857' or '43_3857')."
            )

    # Extract sheet number info
    sheet_number_start_index = match.start()
    seam_id = name_without_ext[:sheet_number_start_index]

    # Check if seam ID ends with underscore
    if not seam_id or not seam_id.endswith('_'):
        return (
            f"Missing mandatory seam ID before sheet number. "
            f"Expected format: SeamID_SheetNumber.zip (e.g., '16516_433857.zip')"
        )

    # Remove trailing underscore and validate
    seam_id_clean = seam_id[:-1]

    if not seam_id_clean or seam_id_clean.strip() == '':
        return (
            f"Missing mandatory seam ID before underscore. "
            f"Expected format: SeamID_SheetNumber.zip (e.g., '16516_433857.zip')"
        )

    # Check alphanumeric
    if not re.match(r'^[a-zA-Z0-9]+$', seam_id_clean):
        return (
            f"Invalid seam ID '{seam_id_clean}'. "
            f"Seam ID must contain only letters and numbers."
        )

    # If we got here, something else is wrong
    return f"Invalid filename format: '{filename}'"


def read_world_file(jpg_path: Path) -> tuple:
    """
    Read georeferencing from world file (.jgw or .jgwx)
    Returns (a, d, b, e, c, f) for affine transformation
    """
    contents = None
    for world_file in [jpg_path.with_suffix(".jgwx"), jpg_path.with_suffix(".jgw")]:
        if world_file.is_file() and contents is None:
            with open(world_file, "r") as file:
                contents = file.readlines()

    if not contents:
        raise ValueError("No world file (.jgw or .jgwx) found for georeferencing")

    if len(contents) != 6 or not all([is_number(i) for i in contents]):
        raise ValueError("Invalid world file format")

    a = float(str(contents[0]).strip())
    d = float(str(contents[1]).strip())
    b = float(str(contents[2]).strip())
    e = float(str(contents[3]).strip())
    c = float(str(contents[4]).strip())
    f = float(str(contents[5]).strip())

    return (a, d, b, e, c, f)


def get_image_dimensions(img_path: Path) -> tuple:
    """
    Get image dimensions (width, height) without loading full image
    For JPG: read from file header
    For TIF: requires rasterio (simplified for now)
    """
    if img_path.suffix.lower() == '.jpg':
        # Read JPEG dimensions from header
        with open(img_path, 'rb') as f:
            # Skip SOI marker
            if f.read(2) != b'\xff\xd8':
                raise ValueError("Not a valid JPEG file")

            # Read through segments to find SOF
            while True:
                marker = f.read(2)
                if len(marker) != 2:
                    raise ValueError("Unexpected end of JPEG file")

                if marker[0] != 0xff:
                    raise ValueError("Invalid JPEG marker")

                # SOF markers (Start of Frame)
                if marker[1] in [0xc0, 0xc1, 0xc2]:
                    f.read(3)  # Skip length and precision
                    height = int.from_bytes(f.read(2), 'big')
                    width = int.from_bytes(f.read(2), 'big')
                    return (width, height)

                # Read segment length and skip
                length = int.from_bytes(f.read(2), 'big')
                f.seek(length - 2, 1)

    # For TIF files, we'd need rasterio - return None for now
    # The validation will fail gracefully
    raise ValueError(f"Cannot read dimensions for {img_path.suffix} files without additional libraries")


def apply_transform(pixel_x: float, pixel_y: float, transform: tuple) -> tuple:
    """
    Apply affine transformation to pixel coordinates
    transform = (a, d, b, e, c, f) where:
    x' = a*x + b*y + c
    y' = d*x + e*y + f
    """
    a, d, b, e, c, f = transform
    geo_x = a * pixel_x + b * pixel_y + c
    geo_y = d * pixel_x + e * pixel_y + f
    return (geo_x, geo_y)


def determine_sheet_number_from_coords(width: int, height: int, transform: tuple) -> str:
    """
    Calculate the correct sheet number from georeferencing
    Uses bottom-left corner of image
    """
    # Bottom-left pixel (0, height)
    bottom_left_x, bottom_left_y = apply_transform(0, height, transform)

    # Round up to nearest 1000m (1km)
    x = str(math.ceil(bottom_left_x / 1000) * 1000)
    y = str(math.ceil(bottom_left_y / 1000) * 1000)

    # Splice into sheet number: format is like "165198"
    # First digit of X + First digit of Y + 2 digits of X + 2 digits of Y
    sheet_number = x[0] + y[0] + x[1:3] + y[1:3]
    return sheet_number


def get_map_bounds(sheet_number: str, shrink_m: int = 2) -> dict:
    """
    Calculate expected map bounds for a sheet number
    Each sheet is 2000m x 1000m
    """
    left = int(sheet_number[0] + sheet_number[2] + sheet_number[3]) * 1000
    bottom = int(sheet_number[1] + sheet_number[4] + sheet_number[5]) * 1000
    top = bottom + 1000
    right = left + 2000

    # Shrink inwards by shrink_m meters
    left += shrink_m
    right -= shrink_m
    top -= shrink_m
    bottom += shrink_m

    return {
        "left": left,
        "right": right,
        "top": top,
        "bottom": bottom
    }


def get_image_bounds(width: int, height: int, transform: tuple) -> dict:
    """
    Calculate actual image bounds in georeferenced coordinates
    """
    # Get all four corners
    top_left = apply_transform(0, 0, transform)
    top_right = apply_transform(width, 0, transform)
    bottom_right = apply_transform(width, height, transform)
    bottom_left = apply_transform(0, height, transform)

    # Get bounding box
    all_x = [top_left[0], top_right[0], bottom_right[0], bottom_left[0]]
    all_y = [top_left[1], top_right[1], bottom_right[1], bottom_left[1]]

    return {
        "left": min(all_x),
        "right": max(all_x),
        "top": max(all_y),
        "bottom": min(all_y)
    }


def bounds_contains(outer: dict, inner: dict) -> bool:
    """Check if outer bounds completely contain inner bounds"""
    return (
        outer["left"] <= inner["left"] and
        outer["right"] >= inner["right"] and
        outer["bottom"] <= inner["bottom"] and
        outer["top"] >= inner["top"]
    )


def validate_map_file(zip_path: Path, original_filename: str = None) -> dict:
    """
    Main validation function
    Returns dict with validation results
    """
    result = {
        "valid": False,
        "error": None,
        "filename_sheet_number": None,
        "actual_sheet_number": None,
        "warning": None
    }

    try:
        # Extract sheet number from original filename (not the temp filename)
        filename_to_check = original_filename if original_filename else zip_path.name
        filename_sheet_number = get_sheet_number_from_filename(filename_to_check)
        if not filename_sheet_number:
            result["error"] = get_filename_validation_error(filename_to_check)
            return result

        result["filename_sheet_number"] = filename_sheet_number

        # Extract ZIP file
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            with zipfile.ZipFile(zip_path, "r") as zip_file:
                zip_file.extractall(temp_path)

            # Find image files (JPG or TIF)
            jpg_files = [f for f in temp_path.rglob("*.jpg") if not f.name.startswith(".")]
            tif_files = [f for f in temp_path.rglob("*.tif") if not f.name.startswith(".")]
            image_files = jpg_files + tif_files

            if len(image_files) == 0:
                result["error"] = "No image files (.jpg or .tif) found in ZIP"
                return result

            if len(image_files) > 1:
                result["error"] = f"Found {len(image_files)} image files in ZIP. Expected exactly 1."
                return result

            img_file = image_files[0]

            # Get georeferencing transformation
            if img_file.suffix.lower() == '.jpg':
                try:
                    transform = read_world_file(img_file)
                except ValueError as e:
                    result["error"] = str(e)
                    return result

                # Check if transform is valid (not at origin)
                if -5 < transform[4] < 5 and -5 < transform[5] < 5:
                    result["error"] = "Georeferencing transformation is invalid (coordinates near origin)"
                    return result

                # Get image dimensions
                try:
                    width, height = get_image_dimensions(img_file)
                except Exception as e:
                    result["error"] = f"Could not read image dimensions: {e}"
                    return result

            elif img_file.suffix.lower() == '.tif':
                # TIF validation requires rasterio - skip for now
                result["warning"] = "TIF file validation not yet implemented. Upload will proceed but may fail during processing."
                result["valid"] = True
                return result
            else:
                result["error"] = f"Unsupported image format: {img_file.suffix}"
                return result

            # Calculate correct sheet number from coordinates
            actual_sheet_number = determine_sheet_number_from_coords(width, height, transform)
            result["actual_sheet_number"] = actual_sheet_number

            # Check if filename sheet number matches actual sheet number
            if filename_sheet_number != actual_sheet_number:
                result["error"] = (
                    f"Sheet number validation failed for '{img_file.name}': "
                    f"extracted sheet number '{filename_sheet_number}' does not match the georeferenced area. "
                    f"The correct sheet number appears to be '{actual_sheet_number}'. "
                    f"Please rename the file to include the correct sheet number."
                )
                return result

            # Validate that image bounds contain map bounds
            map_bounds = get_map_bounds(filename_sheet_number, shrink_m=2)
            image_bounds = get_image_bounds(width, height, transform)

            if not bounds_contains(image_bounds, map_bounds):
                result["error"] = (
                    f"Image bounds do not contain expected map area for sheet {filename_sheet_number}. "
                    f"Image: {image_bounds}, Expected map: {map_bounds}"
                )
                return result

            # All validation passed!
            result["valid"] = True
            return result

    except zipfile.BadZipFile:
        result["error"] = "Invalid ZIP file"
        return result
    except Exception as e:
        result["error"] = f"Validation error: {str(e)}"
        return result


def main():
    """CLI entry point"""
    import sys
    sys.stderr.write(f"[validate_map.py] Starting validation\n")
    sys.stderr.write(f"[validate_map.py] Arguments: {sys.argv}\n")

    if len(sys.argv) not in [2, 3]:
        print(json.dumps({"error": "Usage: validate_map.py <zip_file_path> [original_filename]"}))
        sys.exit(1)

    zip_path = Path(sys.argv[1])
    original_filename = sys.argv[2] if len(sys.argv) == 3 else zip_path.name
    sys.stderr.write(f"[validate_map.py] ZIP path: {zip_path}\n")
    sys.stderr.write(f"[validate_map.py] Original filename: {original_filename}\n")

    if not zip_path.exists():
        print(json.dumps({"error": f"File not found: {zip_path}"}))
        sys.exit(1)

    result = validate_map_file(zip_path, original_filename)
    sys.stderr.write(f"[validate_map.py] Validation result: {result}\n")
    print(json.dumps(result))

    # Exit with status code based on validation result
    sys.exit(0 if result["valid"] else 1)


if __name__ == "__main__":
    main()
