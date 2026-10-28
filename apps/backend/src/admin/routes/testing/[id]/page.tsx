import { Spinner } from "@medusajs/icons"
import { Button, Container, Heading, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"
import { sdk } from "../../../lib/client"

const TestingDetailPage = () => {
  const { id } = useParams()

  const { data, isLoading } = useQuery({
    queryKey: ["testing-product", id],
    queryFn: () =>
      sdk.admin.product.retrieve(id!, { fields: "id,title,handle,+metadata" }),
    enabled: !!id,
  })

  if (isLoading) {
    return (
      <Container className="flex justify-center px-6 py-4">
        <Spinner className="animate-spin" />
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{data?.product.title}</Heading>
        <Link to="/testing">
          <Button size="small" variant="secondary">
            Back
          </Button>
        </Link>
      </div>
      <div className="flex flex-col gap-2 px-6 py-4">
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          Handle: {data?.product.handle}
        </Text>
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          Metadata: {JSON.stringify(data?.product.metadata ?? {})}
        </Text>
        <Link to={`/products/${id}`}>
          <Button size="small" variant="transparent">
            Go to product
          </Button>
        </Link>
      </div>
    </Container>
  )
}

export default TestingDetailPage
