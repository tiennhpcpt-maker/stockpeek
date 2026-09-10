"""
Tu dong ghi lai sector_analysis.json bang gia khop lenh that (khong can AI/API tra phi).
Chay boi GitHub Actions (xem .github/workflows/update-sector-analysis.yml) 2 lan/ngay,
de viec cap nhat khong con phu thuoc vao viec ai do bam nut "Cap nhat" trong trang admin.

Khong tu viet lai logic tinh toan — dung truc tiep compute_sector_analysis() cua server.py
de ket qua GIONG HET voi khi admin bam nut refresh tren trang (mot nguon su that duy nhat).
Chi khac: script nay ghi thang ra file roi de workflow tu commit/push, con server.py ghi
qua GitHub Contents API.
"""
import json
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)
OUTPUT_PATH = os.path.join(REPO_ROOT, "sector_analysis.json")

from server import compute_sector_analysis  # noqa: E402


def main():
    data = compute_sector_analysis()
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    n = len(data.get("sectors") or [])
    print(f"Da cap nhat sector_analysis.json luc {data['generated_at']} ({n} nhom nganh)")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"LOI: {e}", file=sys.stderr)
        sys.exit(1)
