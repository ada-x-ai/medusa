import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps, HttpTypes } from "@medusajs/framework/types"
import { Button, Container, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { sdk } from "../lib/client"

const ProductTestingWidget = ({
  data: product,
}: DetailWidgetProps<HttpTypes.AdminProduct>) => {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ["product-testing", product.id],
    queryFn: () =>
      sdk.admin.product.retrieve(product.id, { fields: "id,+metadata" }),
  })

  const counter = Number(data?.product.metadata?.test_counter ?? 0)

  const increment = useMutation({
    mutationFn: () =>
      sdk.admin.product.update(product.id, {
        metadata: {
          ...data?.product.metadata,
          test_counter: counter + 1,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["product-testing", product.id],
      })
      toast.success("Counter incremented")
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Testing Widget
        </Text>
        <Link to={`/testing/${product.id}`}>
          <Button size="small" variant="secondary">
            Open test page
          </Button>
        </Link>
      </div>
      <div className="flex items-center justify-between px-6 py-4">
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          {isLoading ? "Loading..." : `metadata.test_counter: ${counter}`}
        </Text>
        <Button
          size="small"
          onClick={() => increment.mutate()}
          disabled={isLoading || increment.isPending}
          isLoading={increment.isPending}
        >
          Increment
        </Button>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductTestingWidget
