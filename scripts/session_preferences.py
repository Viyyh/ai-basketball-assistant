"""Optional user-supplied context, kept separate from verified geometry and model facts."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

class Preferences(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    player_names: dict[str,str]=Field(default_factory=dict)
    venue: str=Field(default='',max_length=100)
    format: Literal['unknown','training','1v1','2v2','3v3','4v4','5v5','custom']='unknown'
    environment: Literal['unknown','indoor','outdoor']='unknown'
    court_scope: Literal['unknown','half','full','partial']='unknown'
    court_length_m: float|None=Field(default=None,gt=0,le=100,strict=True)
    court_width_m: float|None=Field(default=None,gt=0,le=100,strict=True)
    hoop_height_m: float|None=Field(default=None,gt=0,le=5,strict=True)
    three_point_radius_m: float|None=Field(default=None,gt=0,le=15,strict=True)
    inside_points: int|None=Field(default=None,ge=1,le=10,strict=True)
    outside_points: int|None=Field(default=None,ge=1,le=10,strict=True)
    free_throw_points: int|None=Field(default=None,ge=1,le=10,strict=True)
    period_minutes: float|None=Field(default=None,gt=0,le=180,strict=True)
    periods: int|None=Field(default=None,ge=1,le=20,strict=True)
    target_score: int|None=Field(default=None,ge=1,le=1000,strict=True)
    shot_clock_seconds: int|None=Field(default=None,ge=1,le=120,strict=True)
    goals: list[Literal['shooting','passing','off_ball','defense','tactics','positioning']]=Field(default_factory=list,max_length=6)
    extra_rules: str=Field(default='',max_length=2000)
    @model_validator(mode='after')
    def consistency(self):
        if any(not k or not isinstance(v,str) or len(v)>60 for k,v in self.player_names.items()):raise ValueError('姓名最多60字，球员ID不能为空')
        if self.inside_points is not None and self.outside_points is not None and self.outside_points<=self.inside_points:raise ValueError('外线分值应大于内线；不适用时留空')
        if len(set(self.goals))!=len(self.goals):raise ValueError('分析目标不能重复')
        return self
