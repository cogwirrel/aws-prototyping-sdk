from aws_prototyping_sdk import pdk_pipeline
from aws_cdk import Stack, pipelines

class PipelineStack(Stack):
    def __init__(self, scope, id, **kwargs):
        super().__init__(scope, id, **kwargs)

        self.pipeline = pdk_pipeline.PDKPipeline(self, "Pipeline",
                                                 primary_synth_directory="packages/infra/cdk.out",
                                                 repository_name="monorepo",
                                                 publish_assets_in_parallel=False,
                                                 pr_build_checker=True,
                                                 cross_account_keys=True,
                                                 synth=pipelines.ShellStep("Unused", commands=[]))
