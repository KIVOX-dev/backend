from pydantic import BaseModel


class GenerateAssessmentQuestionsRequest(BaseModel):
    title: str = "Assessment"
    type: str = "general"
    difficulty: str = "medium"


class AssessmentQuestion(BaseModel):
    question: str
    options: list[str]
    correct_answer: str


class GenerateAssessmentQuestionsResponse(BaseModel):
    questions: list[AssessmentQuestion]
