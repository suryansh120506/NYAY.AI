from pydantic import BaseModel, ConfigDict


class ApiModel(BaseModel):
    """Base for every API model. Fields with defaults are still *always present* in responses, so the response
    (serialization) schema marks them required: the generated TypeScript types then match what the server sends."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)
