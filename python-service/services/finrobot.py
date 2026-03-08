"""FinRobot wrapper — implemented in DAV-25."""


class FinRobotService:
    """Wraps FinRobot Data-CoT, Concept-CoT, and Thesis-CoT agents."""

    async def generate_thesis(self, ticker: str, config: dict) -> dict:
        raise NotImplementedError("Implemented in DAV-25")
