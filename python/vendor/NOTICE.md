# Pinned inference code

`models/bs_roformer/bs_roformer.py`, `models/bs_roformer/attend.py`, and `models/scnet/*.py`
come from ZFTurbo/Music-Source-Separation-Training commit
`050cae7345f4ac1e1e27e066c2c5cdc0a2cdb679`.

Source: https://github.com/ZFTurbo/Music-Source-Separation-Training

The model implementation files are unmodified. The `models` and `models/bs_roformer`
package initializers are empty to avoid importing unrelated model/training dependencies.
The original MIT license is included as MSST-LICENSE.txt. SCNet is by starrytong;
BS RoFormer is based on lucidrains' implementation. PolarFormer uses PoPE-pytorch.
The inference adapter in `../separate.py` uses the reference generic overlap-add
and SCNet normalization, with batch size one, strict checkpoint loading, and explicit
finite-output checks. These code licenses do not override checkpoint licenses.
