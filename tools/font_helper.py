import argparse
import json
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


def axis_name(font, name_id):
    name = font["name"].getName(name_id, 3, 1)
    if name is None:
        name = font["name"].getName(name_id, 1, 0)
    return name.toUnicode() if name is not None else ""


def inspect_font(source):
    font = TTFont(source, lazy=True)
    axes = []
    if "fvar" in font:
        for axis in font["fvar"].axes:
            axes.append({
                "tag": axis.axisTag,
                "name": axis_name(font, axis.axisNameID) or axis.axisTag,
                "min": axis.minValue,
                "default": axis.defaultValue,
                "max": axis.maxValue,
            })
    font.close()
    print(json.dumps({"variable": bool(axes), "axes": axes}, ensure_ascii=False))


def instantiate_font(source, output, axis_values):
    font = TTFont(source)
    if "fvar" not in font:
        raise ValueError("输入字体不是 Variable Font")
    available = {axis.axisTag: axis for axis in font["fvar"].axes}
    location = {}
    for value in axis_values:
        tag, raw = value.split("=", 1)
        if tag not in available:
            raise ValueError(f"字体不存在可变轴：{tag}")
        numeric = float(raw)
        axis = available[tag]
        if numeric < axis.minValue or numeric > axis.maxValue:
            raise ValueError(f"{tag} 超出范围")
        location[tag] = numeric
    for tag, axis in available.items():
        location.setdefault(tag, axis.defaultValue)
    instance = instantiateVariableFont(font, location, inplace=False, static=True, updateFontNames=False)
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    instance.save(output)
    instance.close()
    font.close()
    print(json.dumps({"output": str(Path(output).resolve()), "axes": location}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    inspect_parser = subparsers.add_parser("inspect")
    inspect_parser.add_argument("source")
    instance_parser = subparsers.add_parser("instantiate")
    instance_parser.add_argument("source")
    instance_parser.add_argument("output")
    instance_parser.add_argument("--axis", action="append", default=[])
    args = parser.parse_args()
    if args.command == "inspect":
        inspect_font(args.source)
    else:
        instantiate_font(args.source, args.output, args.axis)


if __name__ == "__main__":
    main()
