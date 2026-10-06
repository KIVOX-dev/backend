from typing import Literal

from pydantic import BaseModel, Field


class ExplainItem(BaseModel):
    question: str = Field(min_length=1, max_length=1500)
    options: list[str] = Field(min_length=2, max_length=6)
    correct_answer: str = Field(min_length=1, max_length=500)
    # The text of a chart/table the question refers to (Data Interpretation).
    data_presentation: str | None = Field(default=None, max_length=1000)


class ExplainRequest(BaseModel):
    questions: list[ExplainItem] = Field(min_length=1, max_length=20)


class Explanation(BaseModel):
    # None when the model produced nothing usable for this question.
    text: str | None = None
    # True when the model believes the stored answer is wrong — surfaced to the
    # student as a caution instead of confidently explaining a bad key.
    disputed: bool = False
    suggested_answer: str | None = None


class ExplainResponse(BaseModel):
    source: Literal["ai", "unavailable"]
    # Same order and length as the request's questions.
    explanations: list[Explanation]
