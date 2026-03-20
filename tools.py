import ast
import operator
from datetime import datetime

# ── OpenAI function-calling schema ────────────────────────────
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_datetime",
            "description": "Returns the current local date and time.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": (
                "Evaluates a safe arithmetic expression and returns the numeric result. "
                "Supports +, -, *, /, //, %, ** and parentheses. "
                "Example: '(3 + 5) * 2' returns '16'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "A math expression, e.g. '(3 + 5) * 2'",
                    }
                },
                "required": ["expression"],
            },
        },
    },
]

# ── Implementations ────────────────────────────────────────────

_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


def _safe_eval(node):
    """Recursively evaluate an AST node using only safe arithmetic operations."""
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        left = _safe_eval(node.left)
        right = _safe_eval(node.right)
        # Guard against absurdly large exponents (e.g. 2**10000000)
        if isinstance(node.op, ast.Pow) and abs(right) > 300:
            raise ValueError("Exponent too large")
        return _OPS[type(node.op)](left, right)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_safe_eval(node.operand))
    raise ValueError(f"Unsupported operation: {ast.dump(node)}")


def _get_datetime() -> str:
    return datetime.now().strftime("%A, %B %d, %Y — %H:%M:%S")


def _calculate(expression: str) -> str:
    try:
        tree = ast.parse(expression.strip(), mode="eval")
        result = _safe_eval(tree.body)
        # Return int repr when result is a whole number
        if isinstance(result, float) and result.is_integer():
            return str(int(result))
        return str(result)
    except ZeroDivisionError:
        return "Error: division by zero"
    except Exception as e:
        return f"Error: {e}"


def execute_tool(name: str, arguments: dict) -> str:
    if name == "get_datetime":
        return _get_datetime()
    if name == "calculate":
        return _calculate(arguments.get("expression", ""))
    return f"Unknown tool: {name}"
