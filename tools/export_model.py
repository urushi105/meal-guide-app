# ============================================================
# export_model.py ： 学習済みモデル(last.pt)を、アプリで使える ONNX 形式に変換する
#
# 使い方（Python と ultralytics が入っているパソコンで）
#   python export_model.py last.pt
#
# できるもの
#   last.onnx  → アプリの model フォルダに置く
#
# ※ クラス名（学習したときの names）も画面に表示されます。
#    config.js の CLASS_TABLE と合っているか確認してください。
# ============================================================

import shutil
import sys

from ultralytics import YOLO


# ※ 変換したいファイル（指定がなければ last.pt）
pt_path = sys.argv[1] if len(sys.argv) > 1 else "last.pt"

model = YOLO(pt_path)


# --- クラス名を表示する ---
print("")
print("クラス名（学習したときの names）:")

for index, name in model.names.items():
    print(f"  {index}: {name}")

print("")


# --- ONNX に変換する ---
# ※ imgsz は学習したときの画像サイズ。ふつうは 640
onnx_path = model.export(format="onnx", imgsz=640)

shutil.copy(onnx_path, "last.onnx")

print("")
print("変換できました → last.onnx")
print("このファイルを、アプリの model フォルダに置いてください。")
