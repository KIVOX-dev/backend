from pydantic import BaseModel


class GenerateAssessmentQuestionsRequest(BaseModel):
    title: str = "Assessment"
    type: str = "general"
    difficulty: str = "medium"
    # Node-api's own callers (test.service.js's admin test-authoring tool,
    # course.service.js's YouTube-lesson quizzes) can ask for a different
    # set size — defaults to 10 to keep every existing caller that omits
    # this field byte-for-byte unchanged.
    count: int = 10


class AssessmentQuestion(BaseModel):
    question: str
    options: list[str]
    correct_answer: str


class GenerateAssessmentQuestionsResponse(BaseModel):
    questions: list[AssessmentQuestion]
