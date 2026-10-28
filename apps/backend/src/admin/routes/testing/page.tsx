import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Beaker, Spinner } from "@medusajs/icons"
import { Container, Heading, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { sdk } from "../../lib/client"

const TestingPage = () => {
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ["testing-products"],
    queryFn: () =>
      sdk.admin.product.list({ limit: 20, fields: "id,title,status" }),
  })

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Testing</Heading>
      </div>
      {isLoading ? (
        <div className="flex justify-center px-6 py-4">
          <Spinner className="animate-spin" />
        </div>
      ) : (
        data?.products.map((product) => (
          <button
            key={product.id}
            onClick={() => navigate(`/testing/${product.id}`)}
            className="hover:bg-ui-bg-base-hover flex w-full items-center justify-between px-6 py-4 text-left"
          >
            <Text size="small" leading="compact" weight="plus">
              {product.title}
            </Text>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              {product.status}
            </Text>
          </button>
        ))
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Testing",
  icon: Beaker,
})

export default TestingPage
