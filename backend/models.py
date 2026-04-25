from pydantic import BaseModel, Field
from typing import List, Optional, Dict


class NewGameRequest(BaseModel):
    league: str = "LEC"


class SignERLPlayerRequest(BaseModel):
    player_id: str = Field(min_length=1, max_length=100)
    offered_salary: int = Field(ge=0, le=50_000_000)


class PlayoffsGameRequest(BaseModel):
    match_id: str = Field(min_length=1, max_length=100)
    user_draft: Optional[Dict] = None


class SimulateMatchRequest(BaseModel):
    match_id: str = Field(min_length=1, max_length=100)
    user_draft: Optional[Dict] = None


class NegotiationOffer(BaseModel):
    player_id: str = Field(min_length=1, max_length=100)
    offered_amount: int = Field(ge=0, le=50_000_000)
    contract_years: int = Field(default=2, ge=1, le=5)
    clauses: Optional[List[str]] = []
    player_to_swap_id: Optional[str] = None
    is_counter_offer: bool = False


class CounterOfferBody(BaseModel):
    amount: int = Field(ge=0, le=50_000_000)


class DraftStartRequest(BaseModel):
    match_id: Optional[str] = None


class DraftAction(BaseModel):
    action: str  # "ban" or "pick"
    champion: str
    position: Optional[str] = None


class TrainingRequest(BaseModel):
    player_id: str
    training_type: str  # scrims, vod_review, bootcamp, rest


class TrainingPlanRequest(BaseModel):
    player_id: str
    training_type: str  # scrims, vod_review, bootcamp, rest, or "" to clear


class TeamTrainingPlanRequest(BaseModel):
    training_type: str  # scrims, vod_review, bootcamp, rest, or "" to clear


class RosterSwapRequest(BaseModel):
    player1_id: str
    player2_id: str


class IntlSimRequest(BaseModel):
    match_id: str
    user_draft: Optional[dict] = None


class _Mp2CreateBody(BaseModel):
    league: str
    username: str


class _Mp2JoinBody(BaseModel):
    code: str
    username: str


class _Mp2TeamBody(BaseModel):
    token: str
    team_id: str


class _Mp2ReadyBody(BaseModel):
    token: str
    action: str


class _Mp2DraftStartBody(BaseModel):
    token: str
    match_id: str


class _Mp2DraftActionBody(BaseModel):
    token: str
    action: str  # "ban" | "pick"
    champion: str
    position: str | None = None
