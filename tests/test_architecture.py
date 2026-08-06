"""Architecture and source-quality regression checks."""

from __future__ import annotations

import ast
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PYTHON_ROOTS = (
    PROJECT_ROOT / "src",
    PROJECT_ROOT / "tests",
)

IGNORED_DIRECTORIES = {
    ".git",
    ".venv",
    ".ansible",
    ".bootstrap-venv",
    "__pycache__",
}


def _python_paths() -> tuple[Path, ...]:
    paths = [PROJECT_ROOT / "bootstrap.py"]
    for root in PYTHON_ROOTS:
        paths.extend(root.rglob("*.py"))
    return tuple(sorted(paths))


def _module_name(path: Path) -> str:
    relative = path.relative_to(PROJECT_ROOT)
    return ".".join(relative.with_suffix("").parts)


def _is_ignored(path: Path) -> bool:
    relative_path = path.relative_to(PROJECT_ROOT)
    return any(part in IGNORED_DIRECTORIES for part in relative_path.parts)


def test_repository_contains_no_shell_command_layer() -> None:
    forbidden_paths = tuple(
        path
        for pattern in ("*.sh", "*.bash")
        for path in PROJECT_ROOT.rglob(pattern)
        if not _is_ignored(path)
    )

    assert forbidden_paths == ()
    assert not (PROJECT_ROOT / "Makefile").exists()


def test_core_layers_do_not_import_infrastructure_libraries() -> None:
    forbidden_imports = {
        "subprocess",
        "yaml",
        "getpass",
    }
    core_paths = tuple((PROJECT_ROOT / "src/platform_infra/domain").rglob("*.py"))
    core_paths += tuple((PROJECT_ROOT / "src/platform_infra/application").rglob("*.py"))

    for path in core_paths:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        imported_roots: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_roots.update(
                    alias.name.partition(".")[0] for alias in node.names
                )
            elif isinstance(node, ast.ImportFrom) and node.module is not None:
                imported_roots.add(node.module.partition(".")[0])
        assert imported_roots.isdisjoint(forbidden_imports), (
            f"{_module_name(path)} imports an infrastructure dependency"
        )


def test_subprocess_is_isolated_to_process_boundaries() -> None:
    allowed = {
        PROJECT_ROOT / "bootstrap.py",
        PROJECT_ROOT / "src/platform_infra/adapters/process.py",
    }
    offenders: list[Path] = []
    for path in _python_paths():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        imports_subprocess = any(
            (
                isinstance(node, ast.Import)
                and any(alias.name == "subprocess" for alias in node.names)
            )
            or (isinstance(node, ast.ImportFrom) and node.module == "subprocess")
            for node in ast.walk(tree)
        )
        if imports_subprocess and path not in allowed:
            offenders.append(path)

    assert offenders == []


def test_public_functions_and_methods_have_complete_annotations() -> None:
    failures: list[str] = []
    for path in _python_paths():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if node.name.startswith("_"):
                continue
            positional = (*node.args.posonlyargs, *node.args.args)
            for argument in (*positional, *node.args.kwonlyargs):
                if argument.arg in {"self", "cls"}:
                    continue
                if argument.annotation is None:
                    failures.append(f"{path}:{node.lineno} argument {argument.arg}")
            if node.args.vararg is not None and node.args.vararg.annotation is None:
                failures.append(f"{path}:{node.lineno} variadic positional argument")
            if node.args.kwarg is not None and node.args.kwarg.annotation is None:
                failures.append(f"{path}:{node.lineno} variadic keyword argument")
            if node.returns is None:
                failures.append(f"{path}:{node.lineno} return value")

    assert failures == []


def test_core_code_does_not_use_typing_any() -> None:
    offenders: list[str] = []
    for path in _python_paths():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))

        offenders.extend(
            f"{path}:{node.lineno}"
            for node in ast.walk(tree)
            if (isinstance(node, ast.Name) and node.id == "Any")
            or (isinstance(node, ast.Attribute) and node.attr == "Any")
        )

    assert offenders == []


def test_python_source_respects_line_length() -> None:
    failures: list[str] = []
    for path in _python_paths():
        for line_number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(),
            start=1,
        ):
            if len(line) > 88:
                failures.append(f"{path}:{line_number}:{len(line)}")

    assert failures == []
